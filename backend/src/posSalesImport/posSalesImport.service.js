const repository = require('./posSalesImport.repository');
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
  // Aggregate duplicates
  const aggregated = {};
  for (const row of rows) {
    if (!aggregated[row.productName]) aggregated[row.productName] = 0;
    aggregated[row.productName] += row.quantity;
  }
  return Object.entries(aggregated).map(([productName, quantity]) => ({ productName, quantity }));
}

/**
 * Build preview items by matching product names against saved mappings.
 */
async function previewSales(restaurantId, buffer) {
  const parsed = parseCSV(buffer);
  const fileHash = repository.computeFileHash(buffer);
  const mappings = await repository.getMappings(restaurantId);
  const items = [];
  let periodStart = null, periodEnd = null; // could be extracted from CSV if present

  for (const sale of parsed) {
    const itemId = mappings[sale.productName] || null;
    const item = itemId ? await getItemDetails(restaurantId, itemId) : null;
    items.push({
      sourceProductName: sale.productName,
      itemId: item ? item.id : null,
      itemName: item ? item.name : null,
      quantitySold: sale.quantity,
      matched: !!itemId
    });
  }

  return { fileHash, periodStart, periodEnd, items };
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
 * Apply a sales import (atomic).
 */
async function applySalesImport(restaurantId, userId, fileHash, periodStart, periodEnd, items) {
  // Re-verify that each item's itemId is valid and belongs to restaurant
  for (const it of items) {
    const item = await getItemDetails(restaurantId, it.itemId);
    if (!item) throw { code: 'ITEM_NOT_FOUND', error: `Item not found: ${it.itemId}` };
  }

  const importId = uuidv4();
  await transaction(async (tx) => {
    // Duplicate check inside transaction
    const dup = await tx(
      `SELECT id FROM sales_imports WHERE restaurant_id = $1 AND file_hash = $2`,
      [restaurantId, fileHash]
    );
    if (dup.rows.length > 0) throw { code: 'SALES_IMPORT_ALREADY_EXISTS', error: 'This sales report has already been imported.' };

    await repository.applyImport(tx, importId, restaurantId, userId, items, fileHash, periodStart, periodEnd);
  });
}

module.exports = {
  previewSales,
  applySalesImport,
  saveProductMapping: repository.saveProductMapping
};