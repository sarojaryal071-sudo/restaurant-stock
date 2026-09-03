'use strict';

/**
 * Tests for the deleteItem fix: previously any unforeseen dependent
 * record (sales history, stock intake, adjustments, allocations,
 * barcodes) hit a raw PostgreSQL foreign-key violation. That error's
 * `.code` is a SQLSTATE ('23503'), not one of this app's semantic error
 * codes, and it has no `.error` message - the response ended up as
 * `{ code: '23503', error: undefined }`, which the frontend's
 * `apiCall` turns into the generic "Request failed" (data.error || 'Request
 * failed'). These are static/source-inspection tests (this sandbox has no
 * reachable live database - see the session's earlier investigation),
 * following the same technique already used elsewhere in this suite.
 *
 * Run with: node --test test/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function readDeleteItemFn() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'inventory.js'), 'utf8');
  const start = src.indexOf('async function deleteItem');
  const end = src.indexOf('\n}\n', start) + 3;
  assert.ok(start !== -1, 'deleteItem not found in inventory.js');
  return src.slice(start, end);
}

test('deleteItem checks every table with a foreign key on items.id, not just recipes', () => {
  const fn = readDeleteItemFn();
  const mustCheck = [
    'recipe_ingredients',
    'sales_import_items',
    'sales_import_effects',
    'stock_intake_items',
    'inventory_adjustments',
    'pending_allocation_details',
    'allocation_logs',
    'product_barcodes'
  ];
  for (const table of mustCheck) {
    assert.ok(fn.includes(table), `deleteItem must check ${table} for dependent records before deleting`);
  }
});

test('deleteItem never deletes historical records to force a delete through - no destructive cleanup', () => {
  const fn = readDeleteItemFn();
  const forbidden = [
    'DELETE FROM sales_import_items',
    'DELETE FROM sales_import_effects',
    'DELETE FROM stock_intake_items',
    'DELETE FROM inventory_adjustments',
    'DELETE FROM pending_allocation_details',
    'DELETE FROM allocation_logs',
    'DELETE FROM recipe_ingredients'
  ];
  for (const stmt of forbidden) {
    assert.ok(!fn.includes(stmt), `deleteItem must never run "${stmt}" - that would destroy historical/operational data`);
  }
});

test('deleteItem only auto-removes the non-historical sales_product_mappings pointer, and only after the historical-dependency check', () => {
  const fn = readDeleteItemFn();
  assert.ok(fn.includes('DELETE FROM sales_product_mappings'), 'deleteItem should clean up an orphaned mapping pointing at the deleted item');

  const depCheckIdx = fn.indexOf('has_sales_import_items');
  const mappingDeleteIdx = fn.indexOf('DELETE FROM sales_product_mappings');
  assert.ok(depCheckIdx !== -1 && mappingDeleteIdx !== -1 && mappingDeleteIdx > depCheckIdx,
    'the mapping cleanup must happen after the historical-dependency check, not before');

  // sales_product_mappings must not be one of the blocking reasons -
  // it's a routing pointer, not a historical record.
  assert.ok(!/reasons\.push\('[^']*mapping/i.test(fn), 'a saved product mapping alone must not block deletion');
});

test('deleteItem never leaves the response error message empty for a raw PostgreSQL error', () => {
  const fn = readDeleteItemFn();
  // The old code: `if (err.code) return res.json({ ok:false, code: err.code, error: err.error })`
  // matched raw pg errors (which have `.code` = a SQLSTATE) and forwarded
  // an undefined `.error`. The fix must require BOTH code and error to be
  // present before trusting them, and handle the FK-violation SQLSTATE
  // (23503) explicitly with a real message.
  assert.ok(!/if \(err\.code\) \{?\s*\n?\s*return res\.json\(\{ ?ok: false, ?code: err\.code, ?error: err\.error ?\}\);?/.test(fn),
    'must not blindly forward err.code/err.error from any thrown value');
  assert.match(fn, /err\.code && err\.error/, 'must check that both code and a real error message are present before forwarding them');
  assert.match(fn, /23503/, 'must explicitly handle a raw foreign-key-violation SQLSTATE with a real message');
});

test('deleteItem still logs the real technical error server-side for debugging', () => {
  const fn = readDeleteItemFn();
  assert.match(fn, /console\.error\('deleteItem error:', err\)/);
});
