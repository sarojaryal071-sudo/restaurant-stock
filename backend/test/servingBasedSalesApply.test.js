'use strict';

/**
 * Integration-level tests for the unified serving resolution in
 * posSalesImport.repository.js:applyImport (approved "Serving-Based
 * Sales - UX-Complete Implementation Plan v2").
 *
 * applyImport takes its `tx` as a parameter specifically so it can be
 * driven without a live database connection - these tests supply a
 * lightweight mock `tx` that recognizes the exact queries applyImport
 * issues (same technique the rest of this suite's static-inspection
 * tests use to work around this sandbox having no reachable Postgres).
 * This runs the REAL applyImport function and REAL conversion engine
 * (recipes.js) end to end, only the SQL execution is faked - so the
 * math, resolution order, and thrown errors are all genuinely exercised.
 *
 * Run with: node --test test/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { applyImport } = require('../src/posSalesImport/posSalesImport.repository');

/**
 * Build a mock `tx(sql, params)` over an in-memory items/stocks table.
 * Records every call so tests can assert on what was written.
 */
function makeMockTx(itemsById, stockByItemId = {}, negativeAllowed = false) {
  const calls = [];
  const stocks = { ...stockByItemId };

  async function tx(sql, params = []) {
    calls.push({ sql, params });
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('INSERT INTO sales_imports')) {
      return { rows: [] };
    }
    if (s.startsWith('SELECT id, name, unit, volume, volume_unit, sales_volume, sales_volume_unit, serving_name')) {
      const itemId = params[0];
      const item = itemsById[itemId];
      return { rows: item ? [item] : [] };
    }
    if (s.startsWith('INSERT INTO sales_import_items')) {
      return { rows: [] };
    }
    if (s.startsWith('INSERT INTO sales_import_effects')) {
      return { rows: [] };
    }
    if (s.startsWith('SELECT quantity FROM stocks')) {
      const itemId = params[0];
      const qty = stocks[itemId];
      return qty === undefined ? { rows: [] } : { rows: [{ quantity: qty }] };
    }
    if (s.startsWith("SELECT value FROM settings WHERE key = 'negativeStockAllowed'")) {
      return { rows: [{ value: negativeAllowed ? 'true' : 'false' }] };
    }
    if (s.startsWith('UPDATE stocks SET quantity')) {
      const [newQty, itemId] = params;
      stocks[itemId] = newQty;
      return { rows: [] };
    }
    if (s.startsWith('INSERT INTO stocks')) {
      const [, itemId, , qty] = params;
      stocks[itemId] = qty;
      return { rows: [] };
    }
    if (s.startsWith('INSERT INTO pos_sales')) {
      return { rows: [] };
    }

    throw new Error(`makeMockTx: unrecognized query: ${s.slice(0, 80)}`);
  }

  return { tx, calls, stocks };
}

function lastCallMatching(calls, prefix) {
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].sql.replace(/\s+/g, ' ').trim().startsWith(prefix)) return calls[i];
  }
  return null;
}

test('Espolón: 6 x configured Shot/4cl against a 700ml bottle -> 0.342857 bottle, displayed as "Shot"', async () => {
  const espolon = {
    id: 'espolon', name: 'Espolón Tequila', unit: 'bottle',
    volume: 700, volume_unit: 'ml',
    sales_volume: 4, sales_volume_unit: 'cl', serving_name: 'Shot'
  };
  const { tx, calls } = makeMockTx({ espolon }, { espolon: 10 });

  await applyImport(tx, 'imp1', 'r1', 'u1', [
    { type: 'inventory', itemId: 'espolon', sourceProductName: 'Espolon', quantitySold: 6 }
  ], 'hash1', null, null);

  const stockUpdate = lastCallMatching(calls, 'UPDATE stocks SET quantity');
  const newQty = stockUpdate.params[0];
  assert.ok(Math.abs((10 - newQty) - (240 / 700)) < 1e-6, `expected deduction ~0.342857, got ${10 - newQty}`);

  const posSalesInsert = lastCallMatching(calls, 'INSERT INTO pos_sales');
  assert.equal(posSalesInsert.params[3], 'Shot');
});

test('Draught beer: 4 x configured Glass/400ml against a 30L keg -> 0.053333 keg, displayed as "Glass"', async () => {
  const draught = {
    id: 'draught', name: 'Klandestina Sunny Lager', unit: 'keg',
    volume: 30, volume_unit: 'L',
    sales_volume: 400, sales_volume_unit: 'ml', serving_name: 'Glass'
  };
  const { tx, calls } = makeMockTx({ draught }, { draught: 5 });

  await applyImport(tx, 'imp2', 'r1', 'u1', [
    { type: 'inventory', itemId: 'draught', sourceProductName: 'Klandestina Sunny Lager', quantitySold: 4 }
  ], 'hash2', null, null);

  const stockUpdate = lastCallMatching(calls, 'UPDATE stocks SET quantity');
  const newQty = stockUpdate.params[0];
  assert.ok(Math.abs((5 - newQty) - (1600 / 30000)) < 1e-6, `expected deduction ~0.053333, got ${5 - newQty}`);

  const posSalesInsert = lastCallMatching(calls, 'INSERT INTO pos_sales');
  assert.equal(posSalesInsert.params[3], 'Glass');
});

test('Unconfigured item (Corona): quantity deducts 1:1 against the stock unit, displayed as the stock unit', async () => {
  const corona = {
    id: 'corona', name: 'Corona 0%', unit: 'bottle',
    volume: null, volume_unit: null,
    sales_volume: null, sales_volume_unit: null, serving_name: null
  };
  const { tx, calls } = makeMockTx({ corona }, { corona: 20 });

  await applyImport(tx, 'imp3', 'r1', 'u1', [
    { type: 'inventory', itemId: 'corona', sourceProductName: 'Corona 0%', quantitySold: 4 }
  ], 'hash3', null, null);

  const stockUpdate = lastCallMatching(calls, 'UPDATE stocks SET quantity');
  assert.equal(stockUpdate.params[0], 16); // 20 - 4

  const posSalesInsert = lastCallMatching(calls, 'INSERT INTO pos_sales');
  assert.equal(posSalesInsert.params[3], 'bottle');
});

test('Per-sale override: default Glass/400ml overridden to Pint/568ml for one sale; item default is untouched', async () => {
  const draught = {
    id: 'draught2', name: 'Klandestina Sunny Lager', unit: 'keg',
    volume: 30, volume_unit: 'L',
    sales_volume: 400, sales_volume_unit: 'ml', serving_name: 'Glass'
  };
  const { tx, calls } = makeMockTx({ draught2: draught }, { draught2: 5 });

  await applyImport(tx, 'imp4', 'r1', 'u1', [
    {
      type: 'inventory', itemId: 'draught2', sourceProductName: 'Klandestina Sunny Lager', quantitySold: 4,
      servingName: 'Pint', salesVolume: 568, salesVolumeUnit: 'ml'
    }
  ], 'hash4', null, null);

  const stockUpdate = lastCallMatching(calls, 'UPDATE stocks SET quantity');
  const newQty = stockUpdate.params[0];
  assert.ok(Math.abs((5 - newQty) - ((4 * 568) / 30000)) < 1e-6, `expected deduction ~0.075733, got ${5 - newQty}`);

  const posSalesInsert = lastCallMatching(calls, 'INSERT INTO pos_sales');
  assert.equal(posSalesInsert.params[3], 'Pint');

  // The in-memory "items table" row passed to applyImport is never
  // mutated by the call - proves the item's permanent configuration
  // (Glass/400ml) was never touched by a per-sale override.
  assert.equal(draught.sales_volume, 400);
  assert.equal(draught.sales_volume_unit, 'ml');
  assert.equal(draught.serving_name, 'Glass');
});

test('Safety: a serving name/volume that cannot convert against the item\'s physical volume is rejected, not silently deducted as stock units', async () => {
  const noVolumeItem = {
    id: 'shotitem', name: 'Mystery Spirit', unit: 'bottle',
    volume: null, volume_unit: null, // physical Volume was never set
    sales_volume: null, sales_volume_unit: null, serving_name: null
  };
  const { tx, calls } = makeMockTx({ shotitem: noVolumeItem }, { shotitem: 10 });

  await assert.rejects(
    () => applyImport(tx, 'imp5', 'r1', 'u1', [
      {
        type: 'inventory', itemId: 'shotitem', sourceProductName: 'Mystery Spirit', quantitySold: 6,
        servingName: 'Shot', salesVolume: 4, salesVolumeUnit: 'cl'
      }
    ], 'hash5', null, null),
    (err) => err.code === 'SERVING_CONVERSION_FAILED'
  );

  // Must never have reached the stock-deduction step.
  assert.equal(lastCallMatching(calls, 'UPDATE stocks SET quantity'), null);
  assert.equal(lastCallMatching(calls, 'INSERT INTO stocks'), null);
});

test('Existing Flatpay/wine variable-pour path is unaffected by a configured serving on the same item', async () => {
  // Item has its OWN configured serving (Shot/4cl) *and* the sale carries
  // a genuine per-row Flatpay pour unit ("ml", quantitySold already a
  // volume) - the raw pour path must still win, unchanged.
  const wineItem = {
    id: 'wine1', name: 'House Red', unit: 'bottle',
    volume: 750, volume_unit: 'ml',
    sales_volume: 4, sales_volume_unit: 'cl', serving_name: 'Shot'
  };
  const { tx, calls } = makeMockTx({ wine1: wineItem }, { wine1: 12 });

  await applyImport(tx, 'imp6', 'r1', 'u1', [
    { type: 'inventory', itemId: 'wine1', sourceProductName: 'House Red', quantitySold: 175, salesUnit: 'ml' }
  ], 'hash6', null, null);

  const stockUpdate = lastCallMatching(calls, 'UPDATE stocks SET quantity');
  const newQty = stockUpdate.params[0];
  assert.ok(Math.abs((12 - newQty) - (175 / 750)) < 1e-6, `expected deduction ~0.233333 (wine pour), got ${12 - newQty}`);

  const posSalesInsert = lastCallMatching(calls, 'INSERT INTO pos_sales');
  assert.equal(posSalesInsert.params[3], 'ml');
});

test('Same-unit direct sale: sales volume unit equal to the stock unit multiplies directly, no physical volume required', async () => {
  const spirit = {
    id: 'spirit1', name: 'House Vodka (by the cl)', unit: 'cl',
    volume: null, volume_unit: null,
    sales_volume: 4, sales_volume_unit: 'cl', serving_name: 'Shot'
  };
  const { tx, calls } = makeMockTx({ spirit1: spirit }, { spirit1: 100 });

  await applyImport(tx, 'imp7', 'r1', 'u1', [
    { type: 'inventory', itemId: 'spirit1', sourceProductName: 'House Vodka', quantitySold: 6 }
  ], 'hash7', null, null);

  const stockUpdate = lastCallMatching(calls, 'UPDATE stocks SET quantity');
  assert.equal(stockUpdate.params[0], 100 - 24); // 6 * 4cl = 24cl, same unit as stock
});

test('Save-as-default wiring: mapping persistence covers the new serving columns and is never auto-invoked by applySalesImport', () => {
  const repoSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'posSalesImport', 'posSalesImport.repository.js'),
    'utf8'
  );

  const saveFnMatch = repoSrc.match(/async function saveProductMapping[\s\S]*?\n}/);
  assert.ok(saveFnMatch, 'saveProductMapping not found');
  assert.match(saveFnMatch[0], /serving_name, sales_volume, sales_volume_unit/, 'saveProductMapping must persist the serving override columns');
  assert.match(saveFnMatch[0], /DO UPDATE SET[\s\S]*serving_name = EXCLUDED\.serving_name/, 'saveProductMapping must upsert (not append) the serving override per product name');
  assert.ok(!/UPDATE items/.test(saveFnMatch[0]), 'saveProductMapping must never write to the items table - only the mapping row');

  const serviceSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'posSalesImport', 'posSalesImport.service.js'),
    'utf8'
  );
  const applyFnMatch = serviceSrc.match(/async function applySalesImport[\s\S]*?\n}\n\n\/\*\*/);
  assert.ok(applyFnMatch, 'applySalesImport not found');
  assert.ok(
    !/saveProductMapping/.test(applyFnMatch[0]),
    'applySalesImport must never call saveProductMapping automatically - persistence is explicit-only ("Save as default for this product")'
  );
});
