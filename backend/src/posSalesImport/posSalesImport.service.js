const repository = require('./posSalesImport.repository');
const salesResolver = require('../sales/salesResolver.service');
const { v4: uuidv4 } = require('uuid');
const { transaction } = require('../../database');

/**
 * Parse CSV buffer into an array of { productName, quantity, unit }.
 *
 * Supported columns:
 *   Product,Quantity
 *   Product,Quantity,Unit
 */
function parseCSV(buffer) {
  const text = buffer.toString('utf-8').trim();
  if (!text) throw { code: 'INVALID_CSV', error: 'CSV file is empty.' };

  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());

  const productIdx = header.indexOf('product');
  const qtyIdx = header.indexOf('quantity');
  const unitIdx = header.indexOf('unit');

  if (productIdx === -1 || qtyIdx === -1) {
    throw { code: 'INVALID_CSV_FORMAT', error: 'CSV must have "Product" and "Quantity" columns.' };
  }

  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < Math.max(productIdx, qtyIdx) + 1) continue;

    const product = cols[productIdx].trim();
    const qty = parseFloat(cols[qtyIdx].trim());
    const unit = unitIdx !== -1 && cols.length > unitIdx
      ? cols[unitIdx].trim()
      : '';

    if (!product || isNaN(qty) || qty < 0) continue;

    rows.push({
      productName: product,
      quantity: qty,
      unit: unit || undefined
    });
  }

  if (rows.length === 0) throw { code: 'INVALID_CSV', error: 'No valid sales rows found.' };

  // Aggregate duplicate product/unit combinations.
  const aggregated = new Map();

  for (const row of rows) {
    const key = `${row.productName}||${row.unit || ''}`;

    if (!aggregated.has(key)) {
      aggregated.set(key, {
        productName: row.productName,
        quantity: 0,
        unit: row.unit
      });
    }

    aggregated.get(key).quantity += row.quantity;
  }

  return Array.from(aggregated.values());
}

async function getItemDetails(restaurantId, itemId) {
  const { query } = require('../../database');

  const res = await query(
    `SELECT id, name FROM items WHERE id = $1 AND restaurant_id = $2 AND is_deleted = FALSE`,
    [itemId, restaurantId]
  );

  return res.rows[0] || null;
}

/**
 * Build preview items by resolving product names against inventory/recipes.
 * This function is read-only and has NO side effects.
 */
async function previewSales(restaurantId, buffer) {
  const parsed = parseCSV(buffer);
  const fileHash = repository.computeFileHash(buffer);
  const mappings = await repository.getMappings(restaurantId);
  const items = [];

  for (const sale of parsed) {
    const sourceProductName = sale.productName;
    const quantitySold = sale.quantity;
    const salesUnit = sale.unit || null;

    const mappedItemId = mappings[sourceProductName] || null;

    if (mappedItemId) {
      const item = await getItemDetails(restaurantId, mappedItemId);

      items.push({
        sourceProductName,
        itemId: item ? item.id : null,
        itemName: item ? item.name : null,
        recipeId: null,
        recipeName: null,
        quantitySold,
        unit: item ? salesUnit : null,
        type: item ? 'inventory' : 'unresolved',
        matched: !!item
      });

      continue;
    }

    const resolution = await salesResolver.resolveSalesProduct(restaurantId, sourceProductName);

    if (resolution.type === 'inventory') {
      const item = await getItemDetails(restaurantId, resolution.id);

      items.push({
        sourceProductName,
        itemId: item ? item.id : null,
        itemName: item ? item.name : null,
        recipeId: null,
        recipeName: null,
        quantitySold,
        unit: item ? salesUnit : null,
        type: 'inventory',
        matched: true
      });
    } else if (resolution.type === 'recipe') {
      items.push({
        sourceProductName,
        itemId: null,
        itemName: null,
        recipeId: resolution.id,
        recipeName: resolution.name,
        quantitySold,
        unit: null,
        type: 'recipe',
        matched: true
      });
    } else if (resolution.type === 'ambiguous') {
      items.push({
        sourceProductName,
        itemId: null,
        itemName: null,
        recipeId: null,
        recipeName: null,
        quantitySold,
        unit: salesUnit,
        type: 'ambiguous',
        matched: false
      });
    } else {
      items.push({
        sourceProductName,
        itemId: null,
        itemName: null,
        recipeId: null,
        recipeName: null,
        quantitySold,
        unit: salesUnit,
        type: 'unresolved',
        matched: false
      });
    }
  }

  return { fileHash, periodStart: null, periodEnd: null, items };
}

/**
 * Apply a sales import atomically.
 *
 * Supports:
 *   - mapped inventory items with itemId
 *   - raw productName resolved again by backend
 *   - recipe sales via recipeId or resolved recipe name
 *   - optional unit for direct inventory serving quantities
 */
async function applySalesImport(restaurantId, userId, fileHash, periodStart, periodEnd, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw { code: 'VALIDATION_ERROR', error: 'items array is required.' };
  }

  const resolvedItems = [];

  for (const it of items) {
    const qty = parseFloat(it.quantitySold || it.quantity);

    if (isNaN(qty) || qty <= 0) {
      throw { code: 'VALIDATION_ERROR', error: 'Each sales item must have a positive quantity.' };
    }

    const productName = (it.sourceProductName || it.productName || '').trim();
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
      throw { code: 'VALIDATION_ERROR', error: 'Each item must have itemId, recipeId, or productName.' };
    }

    const resolution = await salesResolver.resolveSalesProduct(restaurantId, productName);

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
      throw { code: 'AMBIGUOUS_PRODUCT', error: `Ambiguous product name: ${productName}` };
    } else {
      throw { code: 'UNRESOLVED_PRODUCT', error: `Product not found: ${productName}` };
    }
  }

  const importId = uuidv4();

  await transaction(async (tx) => {
    const dup = await tx(
      `SELECT id FROM sales_imports WHERE restaurant_id = $1 AND file_hash = $2`,
      [restaurantId, fileHash]
    );

    if (dup.rows.length > 0) {
      throw { code: 'SALES_IMPORT_ALREADY_EXISTS', error: 'This sales report has already been imported.' };
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

async function cancelSalesImport(restaurantId, userId, importId) {
  await transaction(async (tx) => {
    await repository.cancelImport(tx, importId, restaurantId, userId);
  });
}

module.exports = {
  previewSales,
  applySalesImport,
  cancelSalesImport,
  saveProductMapping: repository.saveProductMapping
};