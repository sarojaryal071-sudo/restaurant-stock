'use strict';

/**
 * Tests for the bulk sales-preview resolution introduced to fix the
 * N+1 query pattern in previewSales (1-3 sequential DB round trips per
 * unique POS product name in the uploaded report).
 *
 * resolveSaleFromMaps is a pure function - given the Maps
 * bulkResolveSalesProducts would have built from a single set of bulk
 * queries, it reproduces the exact same per-row resolution previewSales
 * used to compute with awaited per-row queries. Testing it directly
 * exercises the real resolution logic without needing a live database,
 * and specifically covers the duplicate-item-name ("two items named
 * Klandestina Sunny Lager") scenario this task investigates.
 *
 * Run with: node --test test/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { resolveSaleFromMaps } = require('../src/posSalesImport/posSalesImport.service');

function emptyMaps() {
  return {
    itemsById: new Map(),
    recipesById: new Map(),
    itemsByName: new Map(),
    recipesByName: new Map()
  };
}

test('Mapped item: resolves by saved item_id, unaffected by any duplicate name', () => {
  const maps = emptyMaps();
  maps.itemsById.set('good-id', { id: 'good-id', name: 'Klandestina Sunny Lager' });

  const mapping = { itemId: 'good-id', recipeId: null, unit: null };
  const result = resolveSaleFromMaps('Klandestina Sunny Lager', 4, null, mapping, maps);

  assert.equal(result.type, 'inventory');
  assert.equal(result.itemId, 'good-id');
  assert.equal(result.matched, true);
});

test('Mapped item whose row no longer exists (e.g. soft-deleted): unresolved, not silently matched', () => {
  const maps = emptyMaps(); // itemsById intentionally empty
  const mapping = { itemId: 'missing-id', recipeId: null, unit: null };
  const result = resolveSaleFromMaps('Some Product', 2, null, mapping, maps);

  assert.equal(result.type, 'unresolved');
  assert.equal(result.matched, false);
});

test('Mapped recipe: resolves by saved recipe_id', () => {
  const maps = emptyMaps();
  maps.recipesById.set('r1', { id: 'r1', name: 'Margarita' });

  const mapping = { itemId: null, recipeId: 'r1', unit: null };
  const result = resolveSaleFromMaps('Margarita', 3, null, mapping, maps);

  assert.equal(result.type, 'recipe');
  assert.equal(result.recipeId, 'r1');
  assert.equal(result.matched, true);
});

test('Duplicate item names (the Sunny Lager scenario): unmapped name with 2 item matches -> ambiguous, never silently picks either duplicate', () => {
  const maps = emptyMaps();
  maps.itemsByName.set('klandestina sunny lager', [
    { id: 'configured-id', name: 'Klandestina Sunny Lager' },
    { id: 'duplicate-id', name: 'Klandestina Sunny Lager' }
  ]);

  const result = resolveSaleFromMaps('Klandestina Sunny Lager', 4, null, null, maps);

  assert.equal(result.type, 'ambiguous');
  assert.equal(result.matched, false);
  assert.equal(result.itemId, null);
});

test('Unique name (e.g. Surf Ale): unmapped name with exactly 1 item match resolves normally', () => {
  const maps = emptyMaps();
  maps.itemsByName.set('kalajoki bay surf ale', [
    { id: 'surf-ale-id', name: 'Kalajoki Bay Surf Ale' }
  ]);

  const result = resolveSaleFromMaps('Kalajoki Bay Surf Ale', 4, null, null, maps);

  assert.equal(result.type, 'inventory');
  assert.equal(result.itemId, 'surf-ale-id');
  assert.equal(result.matched, true);
});

test('Unmapped name matching both an item and a recipe: ambiguous', () => {
  const maps = emptyMaps();
  maps.itemsByName.set('house special', [{ id: 'i1', name: 'House Special' }]);
  maps.recipesByName.set('house special', [{ id: 'r1', name: 'House Special' }]);

  const result = resolveSaleFromMaps('House Special', 1, null, null, maps);
  assert.equal(result.type, 'ambiguous');
});

test('Unmapped name with no matches at all: unresolved', () => {
  const maps = emptyMaps();
  const result = resolveSaleFromMaps('Nonexistent Product', 1, null, null, maps);
  assert.equal(result.type, 'unresolved');
  assert.equal(result.matched, false);
});

test('Mapping present but neither itemId nor recipeId set: falls through to name resolution, same as before', () => {
  const maps = emptyMaps();
  maps.itemsByName.set('corona', [{ id: 'corona-id', name: 'Corona' }]);

  const mapping = { itemId: null, recipeId: null, unit: null };
  const result = resolveSaleFromMaps('Corona', 4, null, mapping, maps);

  assert.equal(result.type, 'inventory');
  assert.equal(result.itemId, 'corona-id');
});

test('Structural: bulkResolveSalesProducts issues bulk ANY(...) queries, not one query per product name', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'posSalesImport', 'posSalesImport.service.js'),
    'utf8'
  );
  const fnMatch = src.match(/async function bulkResolveSalesProducts[\s\S]*?\n}/);
  assert.ok(fnMatch, 'bulkResolveSalesProducts not found');
  assert.match(fnMatch[0], /ANY\(\$2::uuid\[\]\)/, 'must bulk-load mapped items by id in one query');
  assert.match(fnMatch[0], /ANY\(\$2::text\[\]\)/, 'must bulk-load unmapped names in one query');
  // At most 4 queries total in this function (items-by-id, recipes-by-id,
  // items-by-name, recipes-by-name), each executed once per preview
  // regardless of how many product names are in the file - not one query
  // per unique product name.
  const queryCalls = fnMatch[0].match(/await query\(/g) || [];
  assert.ok(queryCalls.length <= 4, `expected at most 4 bulk queries, found ${queryCalls.length}`);
});

test('Structural: previewSales resolves rows via the bulk maps, not per-row awaited queries', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'posSalesImport', 'posSalesImport.service.js'),
    'utf8'
  );
  const fnMatch = src.match(/async function previewSales[\s\S]*?\n}/);
  assert.ok(fnMatch, 'previewSales not found');
  assert.match(fnMatch[0], /bulkResolveSalesProducts/, 'previewSales must use the bulk resolver');
  assert.ok(!/await getItemDetails/.test(fnMatch[0]), 'previewSales must not call getItemDetails per row anymore');
  assert.ok(!/await salesResolver\.resolveSalesProduct/.test(fnMatch[0]), 'previewSales must not call resolveSalesProduct per row anymore');
});
