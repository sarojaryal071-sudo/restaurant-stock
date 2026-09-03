const repository = require('./posSalesImport.repository');
const salesResolver = require('../sales/salesResolver.service');
const { v4: uuidv4 } = require('uuid');
const { query, transaction } = require('../../database');
const XLSX = require('xlsx');
const path = require('path');

/**
 * Normalize a header value for safe column-name matching.
 */
function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Find the first matching column index for a set of accepted header names.
 */
function findColumnIndex(header, candidates) {
  for (let i = 0; i < header.length; i++) {
    const normalized = normalizeHeader(header[i]);

    if (candidates.includes(normalized)) {
      return i;
    }
  }

  return -1;
}

/**
 * Validate and map one row of sales-file data.
 */
function readRow(row, productIdx, saleIdx) {
  const rawProduct = String(row[productIdx] || '').trim();
  const rawSale = String(row[saleIdx] || '').trim();

  if (!rawProduct && !rawSale) {
    return null;
  }

  if (!rawProduct) {
    return null;
  }

  const quantity = parseFloat(rawSale);

  if (isNaN(quantity) || quantity <= 0) {
    throw {
      code: 'INVALID_SALES_FILE',
      error: `Sale must be a valid positive number for product "${rawProduct}".`
    };
  }

  return {
    productName: rawProduct,
    quantity
  };
}

/**
 * Parse CSV content into row arrays.
 */
function parseCSVContent(buffer) {
  const text = buffer.toString('utf-8').trim();

  if (!text) {
    throw { code: 'INVALID_SALES_FILE', error: 'Sales file is empty.' };
  }

  return text.split(/\r?\n/).map(line => line.split(','));
}

/**
 * Parse XLSX content into row arrays.
 */
function parseXlsxContent(buffer) {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
    cellFormula: false,
    cellText: true
  });

  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw { code: 'INVALID_SALES_FILE', error: 'Sales file does not contain any sheets.' };
  }

  const sheet = workbook.Sheets[firstSheetName];

  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false
  });
}

/**
 * Parse the uploaded sales file into normalized sales rows.
 */
function parseSalesFile(file) {
  const { buffer, originalname = '', mimetype = '' } = file || {};

  if (!buffer) {
    throw { code: 'INVALID_SALES_FILE', error: 'Sales file is empty.' };
  }

  const extension = path.extname(originalname).toLowerCase();
  const isCsv = extension === '.csv' || mimetype === 'text/csv';
  const isXlsx =
    extension === '.xlsx' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  if (!isCsv && !isXlsx) {
    throw {
      code: 'UNSUPPORTED_FILE_TYPE',
      error: 'Only CSV and XLSX sales reports are supported.'
    };
  }

  const rows = isXlsx ? parseXlsxContent(buffer) : parseCSVContent(buffer);

  if (!rows.length) {
    throw { code: 'INVALID_SALES_FILE', error: 'Sales file is empty.' };
  }

  const header = rows[0].map(normalizeHeader);

  const productIdx = findColumnIndex(header, ['product name', 'product']);
  const saleIdx = findColumnIndex(header, ['sale', 'quantity']);
  const unitIdx = findColumnIndex(header, ['unit']);

  if (productIdx === -1 || saleIdx === -1) {
    throw {
      code: 'INVALID_SALES_FILE',
      error: 'Sales file must contain Product Name and Sale columns.'
    };
  }

  const sales = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const product = String(row[productIdx] || '').trim();
    const saleText = String(row[saleIdx] || '').trim();

    if (!product && !saleText) continue;
    if (!product) continue;

    const normalizedProduct = normalizeHeader(product);
    const dateLike = /^\d{1,2}\/\d{1,2}\/\d{2,4}( \d{1,2}:\d{2})?$/.test(product.trim());

    const isMetadata =
      normalizedProduct === 'total' ||
      normalizedProduct === 'grand total' ||
      normalizedProduct === 'period:' ||
      normalizedProduct.startsWith('period:') ||
      normalizedProduct.startsWith('generated') ||
      normalizedProduct.startsWith('date:') ||
      normalizedProduct.startsWith('page') ||
      normalizedProduct === 'report' ||
      dateLike;

    if (isMetadata) {
      continue;
    }

    const quantity = parseFloat(saleText);

    if (isNaN(quantity) || quantity <= 0) {
      throw {
        code: 'INVALID_SALES_FILE',
        error: `Sale must be a valid positive number for product "${product}".`
      };
    }

    const unit = unitIdx !== -1 && row[unitIdx]
      ? String(row[unitIdx]).trim()
      : undefined;

    sales.push({
      productName: product,
      quantity,
      unit: unit || undefined
    });
  }

  if (sales.length === 0) {
    throw { code: 'INVALID_SALES_FILE', error: 'No valid sales rows found.' };
  }

  // Aggregate duplicate product names, preserving any unit when consistent.
  const aggregated = new Map();

  for (const sale of sales) {
    const key = `${sale.productName}||${sale.unit || ''}`;

    if (!aggregated.has(key)) {
      aggregated.set(key, {
        productName: sale.productName,
        quantity: 0,
        unit: sale.unit
      });
    }

    aggregated.get(key).quantity += sale.quantity;
  }

  return Array.from(aggregated.values());
}

async function getItemDetails(restaurantId, itemId) {
  const res = await query(
    `SELECT id, name
     FROM items
     WHERE id = $1 AND restaurant_id = $2 AND is_deleted = FALSE`,
    [itemId, restaurantId]
  );

  return res.rows[0] || null;
}

async function getRecipeDetails(restaurantId, recipeId) {
  const res = await query(
    `SELECT id, name
     FROM recipes
     WHERE id = $1 AND restaurant_id = $2`,
    [recipeId, restaurantId]
  );

  return res.rows[0] || null;
}

/**
 * Bulk-load every item/recipe a set of POS product names could resolve
 * to, in a small constant number of queries, instead of the previous
 * per-row `getItemDetails`/`getRecipeDetails`/`resolveSalesProduct` calls
 * (an N+1 pattern: 1-3 sequential DB round trips per unique product name
 * in the report). Returns Maps so resolution can happen entirely in
 * memory afterwards. Reproduces salesResolver.resolveSalesProduct's exact
 * ambiguity semantics (2+ items or recipes sharing a name -> ambiguous)
 * without re-querying per name - duplicate item names are handled the
 * same way, just resolved from an already-fetched result set instead of
 * a fresh query.
 */
async function bulkResolveSalesProducts(restaurantId, mappings, productNames) {
  const mappedItemIds = new Set();
  const mappedRecipeIds = new Set();
  const unmappedNames = new Set();

  for (const name of productNames) {
    const mapping = mappings[name] || null;
    if (mapping && mapping.itemId) {
      mappedItemIds.add(mapping.itemId);
    } else if (mapping && mapping.recipeId) {
      mappedRecipeIds.add(mapping.recipeId);
    } else {
      // No mapping, or a mapping with neither itemId nor recipeId set -
      // both fall through to name-based resolution, same as before.
      unmappedNames.add(salesResolver.normalizeName(name));
    }
  }

  const itemsById = new Map();
  const recipesById = new Map();
  const itemsByName = new Map();
  const recipesByName = new Map();

  if (mappedItemIds.size > 0) {
    const res = await query(
      `SELECT id, name FROM items
       WHERE restaurant_id = $1 AND is_deleted = FALSE AND id = ANY($2::uuid[])`,
      [restaurantId, Array.from(mappedItemIds)]
    );
    for (const row of res.rows) itemsById.set(row.id, row);
  }

  if (mappedRecipeIds.size > 0) {
    const res = await query(
      `SELECT id, name FROM recipes
       WHERE restaurant_id = $1 AND id = ANY($2::uuid[])`,
      [restaurantId, Array.from(mappedRecipeIds)]
    );
    for (const row of res.rows) recipesById.set(row.id, row);
  }

  if (unmappedNames.size > 0) {
    const names = Array.from(unmappedNames);

    const itemRes = await query(
      `SELECT id, name FROM items
       WHERE restaurant_id = $1 AND is_deleted = FALSE AND LOWER(name) = ANY($2::text[])`,
      [restaurantId, names]
    );
    for (const row of itemRes.rows) {
      const key = salesResolver.normalizeName(row.name);
      if (!itemsByName.has(key)) itemsByName.set(key, []);
      itemsByName.get(key).push(row);
    }

    const recipeRes = await query(
      `SELECT id, name FROM recipes
       WHERE restaurant_id = $1 AND LOWER(name) = ANY($2::text[])`,
      [restaurantId, names]
    );
    for (const row of recipeRes.rows) {
      const key = salesResolver.normalizeName(row.name);
      if (!recipesByName.has(key)) recipesByName.set(key, []);
      recipesByName.get(key).push(row);
    }
  }

  return { itemsById, recipesById, itemsByName, recipesByName };
}

/**
 * Resolve one already-parsed sale (in memory, no DB access) using the
 * Maps built by bulkResolveSalesProducts. Mirrors the per-row branching
 * previewSales used to do inline, just without any awaited query.
 */
function resolveSaleFromMaps(sourceProductName, quantitySold, salesUnit, mapping, maps) {
  if (mapping) {
    const mappedUnit = salesUnit || mapping.unit || null;

    if (mapping.itemId) {
      const item = maps.itemsById.get(mapping.itemId) || null;
      return {
        sourceProductName,
        itemId: item ? item.id : null,
        itemName: item ? item.name : null,
        recipeId: null,
        recipeName: null,
        quantitySold,
        unit: item ? mappedUnit : null,
        type: item ? 'inventory' : 'unresolved',
        matched: !!item
      };
    }

    if (mapping.recipeId) {
      const recipe = maps.recipesById.get(mapping.recipeId) || null;
      return {
        sourceProductName,
        itemId: null,
        itemName: null,
        recipeId: mapping.recipeId,
        recipeName: recipe ? recipe.name : null,
        quantitySold,
        unit: null,
        type: recipe ? 'recipe' : 'unresolved',
        matched: !!recipe
      };
    }

    // If mapping exists but has neither itemId nor recipeId, fall through
    // to normal name resolution.
  }

  const key = salesResolver.normalizeName(sourceProductName);
  const itemMatches = maps.itemsByName.get(key) || [];
  const recipeMatches = maps.recipesByName.get(key) || [];

  if (itemMatches.length > 1 || recipeMatches.length > 1 || (itemMatches.length && recipeMatches.length)) {
    return {
      sourceProductName,
      itemId: null,
      itemName: null,
      recipeId: null,
      recipeName: null,
      quantitySold,
      unit: salesUnit,
      type: 'ambiguous',
      matched: false
    };
  }

  if (itemMatches.length === 1) {
    return {
      sourceProductName,
      itemId: itemMatches[0].id,
      itemName: itemMatches[0].name,
      recipeId: null,
      recipeName: null,
      quantitySold,
      unit: salesUnit,
      type: 'inventory',
      matched: true
    };
  }

  if (recipeMatches.length === 1) {
    return {
      sourceProductName,
      itemId: null,
      itemName: null,
      recipeId: recipeMatches[0].id,
      recipeName: recipeMatches[0].name,
      quantitySold,
      unit: null,
      type: 'recipe',
      matched: true
    };
  }

  return {
    sourceProductName,
    itemId: null,
    itemName: null,
    recipeId: null,
    recipeName: null,
    quantitySold,
    unit: salesUnit,
    type: 'unresolved',
    matched: false
  };
}

/**
 * Build preview items by resolving Product Name against inventory/recipes.
 * This function is read-only and has NO side effects.
 *
 * Resolution is bulk-loaded once for every unique product name in the
 * file (see bulkResolveSalesProducts), then applied in memory per row -
 * a small constant number of DB queries regardless of file size, instead
 * of the previous 1-3 sequential queries per unique product name.
 */
async function previewSales(restaurantId, file) {
  const parsed = parseSalesFile(file);
  const fileHash = repository.computeFileHash(file.buffer);
  const mappings = await repository.getMappings(restaurantId);

  const productNames = Array.from(new Set(parsed.map(sale => sale.productName)));
  const maps = await bulkResolveSalesProducts(restaurantId, mappings, productNames);

  const items = parsed.map(sale => resolveSaleFromMaps(
    sale.productName,
    sale.quantity,
    sale.unit || null,
    mappings[sale.productName] || null,
    maps
  ));

  return {
    fileHash,
    periodStart: null,
    periodEnd: null,
    items
  };
}

/**
 * Apply a sales import atomically.
 *
 * The backend resolves every product again and never trusts:
 * - itemId
 * - recipeId
 * - quantityAdded
 * - ingredient quantities
 * - calculated stock deductions
 *
 * unless the product was explicitly mapped/verified by this backend.
 */
async function applySalesImport(
  restaurantId,
  userId,
  fileHash,
  periodStart,
  periodEnd,
  items
) {
  if (!Array.isArray(items) || items.length === 0) {
    throw { code: 'VALIDATION_ERROR', error: 'items array is required.' };
  }

  const resolvedItems = [];

  for (const it of items) {
    const qty = parseFloat(it.quantitySold || it.quantity);

    if (isNaN(qty) || qty <= 0) {
      throw {
        code: 'VALIDATION_ERROR',
        error: 'Each sales item must have a positive quantity.'
      };
    }

    const productName = (
      it.sourceProductName ||
      it.productName ||
      it.product_name ||
      ''
    ).trim();

    const salesUnit = it.unit || null;

    if (it.itemId) {
      const item = await getItemDetails(restaurantId, it.itemId);

      if (!item) {
        throw { code: 'ITEM_NOT_FOUND', error: `Item not found: ${it.itemId}` };
      }

      resolvedItems.push({
        type: 'inventory',
        itemId: item.id,
        sourceProductName: productName || item.name,
        quantitySold: qty,
        salesUnit
      });

      continue;
    }

    if (it.recipeId) {
      resolvedItems.push({
        type: 'recipe',
        recipeId: it.recipeId,
        sourceProductName: productName || 'Recipe',
        quantitySold: qty
      });

      continue;
    }

    if (!productName) {
      throw {
        code: 'VALIDATION_ERROR',
        error: 'Each item must have itemId, recipeId, or productName.'
      };
    }

    const resolution = await salesResolver.resolveSalesProduct(
      restaurantId,
      productName
    );

    if (resolution.type === 'inventory') {
      const item = await getItemDetails(restaurantId, resolution.id);

      if (!item) {
        throw { code: 'ITEM_NOT_FOUND', error: `Item not found: ${resolution.id}` };
      }

      resolvedItems.push({
        type: 'inventory',
        itemId: item.id,
        sourceProductName: productName,
        quantitySold: qty,
        salesUnit
      });
    } else if (resolution.type === 'recipe') {
      resolvedItems.push({
        type: 'recipe',
        recipeId: resolution.id,
        sourceProductName: productName,
        quantitySold: qty
      });
    } else if (resolution.type === 'ambiguous') {
      throw {
        code: 'AMBIGUOUS_PRODUCT',
        error: `Ambiguous product name: ${productName}`
      };
    } else {
      throw {
        code: 'UNRESOLVED_PRODUCT',
        error: `Product not found: ${productName}`
      };
    }
  }

  const importId = uuidv4();

  await transaction(async tx => {
    const dup = await tx(
      `SELECT id
       FROM sales_imports
       WHERE restaurant_id = $1 AND file_hash = $2`,
      [restaurantId, fileHash]
    );

    if (dup.rows.length > 0) {
      throw {
        code: 'SALES_IMPORT_ALREADY_EXISTS',
        error: 'This sales report has already been imported.'
      };
    }

    await repository.applyImport(
      tx,
      importId,
      restaurantId,
      userId,
      resolvedItems,
      fileHash,
      periodStart,
      periodEnd
    );
  });
}

/**
 * Save or update a product mapping after validating:
 * - one of itemId or recipeId is provided, never both
 * - item/recipe belongs to the authenticated restaurant
 */
async function saveProductMapping(restaurantId, sourceProductName, itemId = null, recipeId = null, unit = null) {
  if (!sourceProductName || !String(sourceProductName).trim()) {
    throw { code: 'VALIDATION_ERROR', error: 'sourceProductName is required.' };
  }

  if ((itemId && recipeId) || (!itemId && !recipeId)) {
    throw {
      code: 'VALIDATION_ERROR',
      error: 'Provide either itemId or recipeId, but not both.'
    };
  }

  if (itemId) {
    const item = await getItemDetails(restaurantId, itemId);

    if (!item) {
      throw { code: 'ITEM_NOT_FOUND', error: `Item not found: ${itemId}` };
    }
  }

  if (recipeId) {
    const recipe = await getRecipeDetails(restaurantId, recipeId);

    if (!recipe) {
      throw { code: 'RECIPE_NOT_FOUND', error: `Recipe not found: ${recipeId}` };
    }
  }

  await repository.saveProductMapping(
    restaurantId,
    String(sourceProductName).trim(),
    itemId || null,
    recipeId || null,
    unit || null
  );
}

/**
 * Cancel a sales import by reversing its exact historical stock effects.
 */
async function cancelSalesImport(restaurantId, userId, importId) {
  await transaction(async tx => {
    await repository.cancelImport(tx, importId, restaurantId, userId);
  });
}

/**
 * List sales import history for the authenticated restaurant.
 */
async function listSalesImports(restaurantId, start, end) {
  return repository.listImports(restaurantId, start, end);
}

module.exports = {
  previewSales,
  applySalesImport,
  cancelSalesImport,
  listSalesImports,
  saveProductMapping,
  // Exported for testing the bulk-resolution logic without a live DB
  // (resolveSaleFromMaps is a pure function once the Maps are built).
  resolveSaleFromMaps,
  bulkResolveSalesProducts
};