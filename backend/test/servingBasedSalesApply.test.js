'use strict';

/**
 * Integration-level tests for posSalesImport.repository.js:applyImport's
 * single-Unit-field resolution (Sales UI fix: restore the simple
 * "POS Product | Resolved To | Qty Sold | Unit | Status" table; the Unit
 * field's selected value defaults to the item's configured serving_name
 * when one exists, else the item's stock unit - Item Configuration
 * remains the only source of truth, with no separate serving system in
 * Sales).
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

test('Espolón: Unit = configured serving name "Shot" -> 6 x 4cl against a 700ml bottle = 0.342857 bottle', async () => {
  const espolon = {
    id: 'espolon', name: 'Espolón Tequila', unit: 'bottle',
    volume: 700, volume_unit: 'ml',
    sales_volume: 4, sales_volume_unit: 'cl', serving_name: 'Shot'
  };
  const { tx, calls } = makeMockTx({ espolon }, { espolon: 10 });

  // salesUnit is exactly what the Sales "Unit" select defaults to and
  // sends - the item's own configured serving_name, "Shot".
  await applyImport(tx, 'imp1', 'r1', 'u1', [
    { type: 'inventory', itemId: 'espolon', sourceProductName: 'Espolon', quantitySold: 6, salesUnit: 'Shot' }
  ], 'hash1', null, null);

  const stockUpdate = lastCallMatching(calls, 'UPDATE stocks SET quantity');
  const newQty = stockUpdate.params[0];
  assert.ok(Math.abs((10 - newQty) - (240 / 700)) < 1e-6, `expected deduction ~0.342857, got ${10 - newQty}`);

  const posSalesInsert = lastCallMatching(calls, 'INSERT INTO pos_sales');
  assert.equal(posSalesInsert.params[3], 'Shot');
});

test('Draught beer: Unit = configured serving name "Glass" -> 4 x 400ml against a 30L keg = 0.053333 keg', async () => {
  const draught = {
    id: 'draught', name: 'Klandestina Sunny Lager', unit: 'keg',
    volume: 30, volume_unit: 'L',
    sales_volume: 400, sales_volume_unit: 'ml', serving_name: 'Glass'
  };
  const { tx, calls } = makeMockTx({ draught }, { draught: 5 });

  await applyImport(tx, 'imp2', 'r1', 'u1', [
    { type: 'inventory', itemId: 'draught', sourceProductName: 'Klandestina Sunny Lager', quantitySold: 4, salesUnit: 'Glass' }
  ], 'hash2', null, null);

  const stockUpdate = lastCallMatching(calls, 'UPDATE stocks SET quantity');
  const newQty = stockUpdate.params[0];
  assert.ok(Math.abs((5 - newQty) - (1600 / 30000)) < 1e-6, `expected deduction ~0.053333, got ${5 - newQty}`);

  const posSalesInsert = lastCallMatching(calls, 'INSERT INTO pos_sales');
  assert.equal(posSalesInsert.params[3], 'Glass');
});

test('Unconfigured item (Corona): Unit = stock unit -> quantity deducts 1:1, displayed as the stock unit', async () => {
  const corona = {
    id: 'corona', name: 'Corona 0%', unit: 'bottle',
    volume: null, volume_unit: null,
    sales_volume: null, sales_volume_unit: null, serving_name: null
  };
  const { tx, calls } = makeMockTx({ corona }, { corona: 20 });

  await applyImport(tx, 'imp3', 'r1', 'u1', [
    { type: 'inventory', itemId: 'corona', sourceProductName: 'Corona 0%', quantitySold: 4, salesUnit: 'Bottle' }
  ], 'hash3', null, null);

  const stockUpdate = lastCallMatching(calls, 'UPDATE stocks SET quantity');
  assert.equal(stockUpdate.params[0], 16); // 20 - 4

  const posSalesInsert = lastCallMatching(calls, 'INSERT INTO pos_sales');
  assert.equal(posSalesInsert.params[3], 'Bottle');
});

test('Unit remains editable: selecting the plain stock unit instead of the configured serving does NOT apply the serving conversion', async () => {
  // Same item as the Espolón test (Shot/4cl configured), but the sale
  // explicitly picked the item's own stock unit instead - the existing
  // Unit control, not a new one, decides which path is taken.
  const espolon = {
    id: 'espolon2', name: 'Espolón Tequila', unit: 'bottle',
    volume: 700, volume_unit: 'ml',
    sales_volume: 4, sales_volume_unit: 'cl', serving_name: 'Shot'
  };
  const { tx, calls } = makeMockTx({ espolon2: espolon }, { espolon2: 10 });

  await applyImport(tx, 'imp4', 'r1', 'u1', [
    { type: 'inventory', itemId: 'espolon2', sourceProductName: 'Espolon', quantitySold: 6, salesUnit: 'bottle' }
  ], 'hash4', null, null);

  const stockUpdate = lastCallMatching(calls, 'UPDATE stocks SET quantity');
  assert.equal(stockUpdate.params[0], 4); // 10 - 6, raw count, no serving conversion applied

  const posSalesInsert = lastCallMatching(calls, 'INSERT INTO pos_sales');
  assert.equal(posSalesInsert.params[3], 'bottle');
});

test('Safety: configured serving selected but sales_volume/unit cannot be resolved -> rejected, never silently deducted as stock units', async () => {
  const brokenConfig = {
    id: 'shotitem', name: 'Mystery Spirit', unit: 'bottle',
    volume: null, volume_unit: null,
    sales_volume: null, sales_volume_unit: null, // serving_name set but no volume/unit behind it
    serving_name: 'Shot'
  };
  const { tx, calls } = makeMockTx({ shotitem: brokenConfig }, { shotitem: 10 });

  await assert.rejects(
    () => applyImport(tx, 'imp5', 'r1', 'u1', [
      { type: 'inventory', itemId: 'shotitem', sourceProductName: 'Mystery Spirit', quantitySold: 6, salesUnit: 'Shot' }
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
  // volume, not matching the configured serving name) - the raw pour
  // path must still win, unchanged.
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

test('Same-unit direct sale: configured serving unit equal to the stock unit multiplies directly, no physical volume required', async () => {
  const spirit = {
    id: 'spirit1', name: 'House Vodka (by the cl)', unit: 'cl',
    volume: null, volume_unit: null,
    sales_volume: 4, sales_volume_unit: 'cl', serving_name: 'Shot'
  };
  const { tx, calls } = makeMockTx({ spirit1: spirit }, { spirit1: 100 });

  await applyImport(tx, 'imp7', 'r1', 'u1', [
    { type: 'inventory', itemId: 'spirit1', sourceProductName: 'House Vodka', quantitySold: 6, salesUnit: 'Shot' }
  ], 'hash7', null, null);

  const stockUpdate = lastCallMatching(calls, 'UPDATE stocks SET quantity');
  assert.equal(stockUpdate.params[0], 100 - 24); // 6 * 4cl = 24cl, same unit as stock
});

test('Reverted: mapping persistence no longer stores a per-mapping serving override - Item Configuration is the only source of truth', () => {
  const repoSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'posSalesImport', 'posSalesImport.repository.js'),
    'utf8'
  );

  const saveFnMatch = repoSrc.match(/async function saveProductMapping[\s\S]*?\n}/);
  assert.ok(saveFnMatch, 'saveProductMapping not found');
  assert.ok(!/serving_name/.test(saveFnMatch[0]), 'saveProductMapping must not read/write a per-mapping serving override');
  assert.ok(!/sales_volume/.test(saveFnMatch[0]), 'saveProductMapping must not read/write a per-mapping serving override');

  const serviceSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'posSalesImport', 'posSalesImport.service.js'),
    'utf8'
  );
  assert.ok(!/getKnownServingNames/.test(serviceSrc), 'the removed serving-names datalist endpoint must not be reintroduced');
});
