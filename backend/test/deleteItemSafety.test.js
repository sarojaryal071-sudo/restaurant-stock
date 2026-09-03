'use strict';

/**
 * Tests for deleteItem's dependency checks, safe cleanup, and error
 * handling - specifically covering the failure mode reported live:
 * deleting an item with a zero-quantity stocks row and a stray
 * sales_product_mappings row was returning HTTP 500.
 *
 * Root cause (fixed here): the dependency-check query referenced
 * `inventory_adjustments.item_id`, a column that does not exist on that
 * table (inventory_adjustments is only the batch/header row; the actual
 * per-item foreign key is on inventory_adjustment_items). That made the
 * query fail with a real PostgreSQL "column does not exist" error on
 * every single delete attempt - not just this item - which fell through
 * to the generic 500 fallback. A second, compounding bug: the frontend's
 * apiCall() discarded the response body on any non-2xx HTTP status, so
 * even a well-formed backend error message never reached the user.
 *
 * deleteItemTx(tx, itemId, restaurantId) takes `tx` as a parameter
 * (the same pattern already used by posSalesImport.repository.js's
 * applyImport) specifically so it can be driven with a mock transaction
 * here - this sandbox has no reachable live database, used throughout
 * this session's work on this codebase.
 *
 * Run with: node --test test/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { deleteItemTx, mapDeleteError } = require('../inventory');

/**
 * Mock tx(sql, params) recognizing the exact queries deleteItemTx issues.
 * `deps` configures which dependency-check flags come back true;
 * `stockQuantity` configures the SUM(quantity) result.
 */
function makeMockTx({ hasRecipeRef = false, deps = {}, stockQuantity = 0 } = {}) {
  const calls = [];

  async function tx(sql, params = []) {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('SELECT id FROM recipe_ingredients')) {
      return { rows: hasRecipeRef ? [{ id: 'ri1' }] : [] };
    }
    if (s.startsWith('SELECT EXISTS(SELECT 1 FROM sales_import_items')) {
      return {
        rows: [{
          has_sales_import_items: !!deps.has_sales_import_items,
          has_sales_import_effects: !!deps.has_sales_import_effects,
          has_stock_intake: !!deps.has_stock_intake,
          has_adjustment_items: !!deps.has_adjustment_items,
          has_pending_allocations: !!deps.has_pending_allocations,
          has_allocation_logs: !!deps.has_allocation_logs,
          has_barcodes: !!deps.has_barcodes
        }]
      };
    }
    if (s.startsWith('SELECT COALESCE(SUM(quantity), 0)')) {
      return { rows: [{ total_quantity: stockQuantity }] };
    }
    if (s.startsWith('DELETE FROM sales_product_mappings')) {
      return { rows: [] };
    }
    if (s.startsWith('DELETE FROM stocks')) {
      return { rows: [] };
    }
    if (s.startsWith('DELETE FROM items')) {
      return { rows: [] };
    }

    throw new Error(`makeMockTx: unrecognized query: ${s.slice(0, 80)}`);
  }

  return { tx, calls };
}

function calledWith(calls, prefix) {
  return calls.some(c => c.sql.startsWith(prefix));
}

test('Test 1 - item with no dependencies deletes successfully', async () => {
  const { tx, calls } = makeMockTx({});
  await deleteItemTx(tx, 'item-1', 'r1');

  assert.ok(calledWith(calls, 'DELETE FROM items'), 'item must be deleted');
});

test('Test 2 - item with only a sales_product_mappings row: mapping is cleaned up, item deletes', async () => {
  // No historical dependency flags set, no stock - the mapping row
  // itself isn't checked in deps (it's not a blocker), it's always
  // cleaned up unconditionally once nothing else blocks deletion.
  const { tx, calls } = makeMockTx({ stockQuantity: 0 });
  await deleteItemTx(tx, 'item-2', 'r1');

  assert.ok(calledWith(calls, 'DELETE FROM sales_product_mappings'), 'orphaned mapping must be cleaned up');
  assert.ok(calledWith(calls, 'DELETE FROM items'), 'item must be deleted');
});

test('Test 3 - item with a zero-quantity stocks row: stock is safely cleared, item deletes', async () => {
  const { tx, calls } = makeMockTx({ stockQuantity: 0 });
  await deleteItemTx(tx, 'item-3', 'r1');

  assert.ok(calledWith(calls, 'DELETE FROM stocks'), 'zero-quantity stock row must be cleared');
  assert.ok(calledWith(calls, 'DELETE FROM items'), 'item must be deleted');
});

test('Test 4 - item with both zero-quantity stock AND a mapping: both handled, item deletes', async () => {
  const { tx, calls } = makeMockTx({ stockQuantity: 0 });
  await deleteItemTx(tx, 'item-4', 'r1');

  const mappingIdx = calls.findIndex(c => c.sql.startsWith('DELETE FROM sales_product_mappings'));
  const stockIdx = calls.findIndex(c => c.sql.startsWith('DELETE FROM stocks'));
  const itemIdx = calls.findIndex(c => c.sql.startsWith('DELETE FROM items'));

  assert.ok(mappingIdx !== -1 && stockIdx !== -1 && itemIdx !== -1, 'all three cleanup/delete steps must run');
  // Order matters for correctness under FK constraints: the item row
  // itself must be deleted last.
  assert.ok(mappingIdx < itemIdx && stockIdx < itemIdx, 'mapping and stock cleanup must happen before the item delete');
});

test('Test 5 - item with positive stock: deletion is blocked, nothing is deleted', async () => {
  const { tx, calls } = makeMockTx({ stockQuantity: 3.5 });

  await assert.rejects(
    () => deleteItemTx(tx, 'item-5', 'r1'),
    (err) => err.code === 'ITEM_HAS_STOCK' && /3\.5/.test(err.error)
  );

  assert.ok(!calledWith(calls, 'DELETE FROM stocks'), 'must not touch stock with a positive quantity');
  assert.ok(!calledWith(calls, 'DELETE FROM sales_product_mappings'), 'must not clean up anything once blocked');
  assert.ok(!calledWith(calls, 'DELETE FROM items'), 'must not delete the item while stock remains');
});

test('Test 6 - item with historical sales_import_items: deletion is blocked', async () => {
  const { tx, calls } = makeMockTx({ deps: { has_sales_import_items: true } });

  await assert.rejects(
    () => deleteItemTx(tx, 'item-6', 'r1'),
    (err) => err.code === 'ITEM_IN_USE' && /historical sales records/.test(err.error)
  );
  assert.ok(!calledWith(calls, 'DELETE FROM items'), 'must not delete the item');
});

test('Test 7 - item with historical sales_import_effects: deletion is blocked', async () => {
  const { tx, calls } = makeMockTx({ deps: { has_sales_import_effects: true } });

  await assert.rejects(
    () => deleteItemTx(tx, 'item-7', 'r1'),
    (err) => err.code === 'ITEM_IN_USE' && /historical sales records/.test(err.error)
  );
  assert.ok(!calledWith(calls, 'DELETE FROM items'));
});

test('Test 8 - item with historical stock_intake_items: deletion is blocked', async () => {
  const { tx, calls } = makeMockTx({ deps: { has_stock_intake: true } });

  await assert.rejects(
    () => deleteItemTx(tx, 'item-8', 'r1'),
    (err) => err.code === 'ITEM_IN_USE' && /stock intake/.test(err.error)
  );
  assert.ok(!calledWith(calls, 'DELETE FROM items'));
});

test('Test 8b - item with historical inventory_adjustment_items: deletion is blocked (regression test for the column-name bug)', async () => {
  const { tx, calls } = makeMockTx({ deps: { has_adjustment_items: true } });

  await assert.rejects(
    () => deleteItemTx(tx, 'item-8b', 'r1'),
    (err) => err.code === 'ITEM_IN_USE' && /adjustment records/.test(err.error)
  );
  assert.ok(!calledWith(calls, 'DELETE FROM items'));
  // The exact query text must reference the table that actually has the
  // item_id column - this is the live bug this task fixes.
  const depQuery = calls.find(c => c.sql.startsWith('SELECT EXISTS(SELECT 1 FROM sales_import_items'));
  assert.ok(depQuery, 'dependency-check query not found');
  assert.match(depQuery.sql, /inventory_adjustment_items/, 'must query inventory_adjustment_items, not inventory_adjustments');
  assert.ok(!/FROM inventory_adjustments WHERE item_id/.test(depQuery.sql), 'must not reference the nonexistent inventory_adjustments.item_id column');
});

test('Test 9 - a simulated PostgreSQL 23503 error produces a meaningful message, not undefined/"Request failed"', () => {
  const pgError = { code: '23503', message: 'update or delete on table "items" violates foreign key constraint "some_fkey" on table "some_table"' };
  const mapped = mapDeleteError(pgError);

  assert.equal(mapped.code, 'ITEM_IN_USE');
  assert.ok(mapped.error && mapped.error.length > 0, 'error message must not be empty/undefined');
  assert.ok(!/23503/.test(mapped.error), 'must not leak the raw SQLSTATE to the user');
  assert.equal(mapped.status, 200, 'a handled, expected condition should not be a 500');
});

test('Test 9b - a genuinely unexpected error (e.g. the column-does-not-exist bug) still returns a real message, and mapDeleteError never reads err.error off a raw PostgreSQL error', () => {
  const pgError = { code: '42703', message: 'column "item_id" does not exist' };
  const mapped = mapDeleteError(pgError);

  assert.equal(mapped.status, 500);
  assert.equal(mapped.error, 'column "item_id" does not exist', 'must use err.message, not the (nonexistent) err.error, for a raw pg error');
});

test('Test 9c - an application-thrown error (both code and error set) is forwarded as a normal 200 response, not a 500', () => {
  const appError = { code: 'ITEM_HAS_STOCK', error: 'This item still has 4 in stock and cannot be deleted while stock remains. Reduce the stock to zero first, or keep the item instead of deleting it.' };
  const mapped = mapDeleteError(appError);

  assert.equal(mapped.status, 200);
  assert.equal(mapped.code, 'ITEM_HAS_STOCK');
  assert.equal(mapped.error, appError.error);
});

test('Test 10 - frontend reads the backend\'s error message on a non-2xx HTTP response instead of discarding it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'api.js'), 'utf8');
  const fnMatch = src.match(/if \(!res\.ok\) \{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'the !res.ok branch was not found in apiCall');
  assert.match(fnMatch[0], /await res\.json\(\)/, 'must attempt to read the JSON body on a non-ok response');
  assert.match(fnMatch[0], /data\.error/, 'must use the backend\'s data.error when present');
});

test('Structural: deleteItem checks every table with a foreign key on items.id', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'inventory.js'), 'utf8');
  const fnMatch = src.match(/async function deleteItemTx[\s\S]*?\n}/);
  assert.ok(fnMatch, 'deleteItemTx not found');

  const mustCheck = [
    'recipe_ingredients',
    'sales_import_items',
    'sales_import_effects',
    'stock_intake_items',
    'inventory_adjustment_items',
    'pending_allocation_details',
    'allocation_logs',
    'product_barcodes'
  ];
  for (const table of mustCheck) {
    assert.ok(fnMatch[0].includes(table), `deleteItemTx must check ${table} for dependent records`);
  }
});

test('Structural: deleteItemTx never deletes historical records to force a delete through', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'inventory.js'), 'utf8');
  const fnMatch = src.match(/async function deleteItemTx[\s\S]*?\n}/);
  const forbidden = [
    'DELETE FROM sales_import_items',
    'DELETE FROM sales_import_effects',
    'DELETE FROM stock_intake_items',
    'DELETE FROM inventory_adjustment_items',
    'DELETE FROM pending_allocation_details',
    'DELETE FROM allocation_logs',
    'DELETE FROM recipe_ingredients'
  ];
  for (const stmt of forbidden) {
    assert.ok(!fnMatch[0].includes(stmt), `deleteItemTx must never run "${stmt}"`);
  }
});
