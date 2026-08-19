const repository = require('./posSalesImport.repository');
const salesResolver = require('../sales/salesResolver.service');
const { v4: uuidv4 } = require('uuid');
const { transaction } = require('../../database');

/**
 * Parse CSV buffer into an array of { productName, quantity }.
 * Expects columns: Product, Quantity (case-insensitive header).
 */
function parseCSV(buffer) {
  const text = buffer.toString('utf-8').trim();
  if (!text) throw { code: 'INVALID_CSV', error: 'CSV file is empty.' };

  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const productIdx = header.indexOf('product');
  const qtyIdx = header.indexOf('quantity');

  if (productIdx === -1 || qtyIdx === -1) {
    throw { code: 'INVALID_CSV_FORMAT', error: 'CSV must have "Product" and "Quantity" columns.' };
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < Math.max(productIdx, qtyIdx) + 1) continue;
    const product = cols[productIdx].trim();
    const qty = parseFloat(cols[qtyIdx].trim());
    if (!product || isNaN(qty) || qty < 0) continue;
    rows.push({ productName: product, quantity: qty });
  }

  if (rows.length === 0) throw { code: 'INVALID_CSV', error: 'No valid sales rows found.' };

  const aggregated = {};
  for (const row of rows) {
    if (!aggregated[row.productName]) aggregated[row.productName] = 0;
    aggregated[row.productName] += row.quantity;
  }

  return Object.entries(aggregated).map(([productName, quantity]) => ({
    productName,
    quantity
  }));
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
 * Accepts either legacy mapped items with itemId,
 * or raw product facts such as { productName, quantity }
 * which are resolved again on the backend before any stock change.
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

    if (it.itemId) {
      const item = await getItemDetails(restaurantId, it.itemId);
      if (!item) {
        throw { code: 'ITEM_NOT_FOUND', error: `Item not found: ${it.itemId}` };
      }
      resolvedItems.push({
        type: 'inventory',
        itemId: item.id,
        sourceProductName: productName || item.name,
        quantitySold: qty
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
        quantitySold: qty
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

module.exports = {
  previewSales,
  applySalesImport,
  saveProductMapping: repository.saveProductMapping
};