'use strict';

/**
 * Tests for the Recipe Cost feature's pure calculation functions:
 * computeIngredientCost, computePricing, sellingPriceFromTargetMargin
 * (backend/recipeCost.js).
 *
 * These are pure functions taking plain data in and returning plain data
 * out - no database required, matching this project's established
 * pattern for testing business logic in a sandbox with no reachable
 * live Postgres (see deleteItemSafety.test.js, servingConversion.test.js).
 *
 * Run with: node --test test/
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeIngredientCost,
  computePricing,
  sellingPriceFromTargetMargin
} = require('../recipeCost');

// -------------------------------------------------------------------
// computeIngredientCost
// -------------------------------------------------------------------

test('ingredient cost: volume-based conversion (Mundo 4cl @ EUR25/70cl)', () => {
  const item = { unit: 'bottle', volume: 70, volumeUnit: 'cl', purchaseCost: 25 };
  const { cost, status } = computeIngredientCost(4, 'cl', item);
  assert.equal(status, 'ok');
  assert.ok(Math.abs(cost - 1.4285714285714286) < 1e-9);
  assert.equal(cost.toFixed(2), '1.43');
});

test('ingredient cost: volume-based conversion via ml (700ml bottle, 4cl usage)', () => {
  const item = { unit: 'bottle', volume: 700, volumeUnit: 'ml', purchaseCost: 25 };
  const { cost, status } = computeIngredientCost(4, 'cl', item);
  assert.equal(status, 'ok');
  assert.equal(cost.toFixed(2), '1.43');
});

test('ingredient cost: multiple ingredients summed (spec example)', () => {
  const mundo = computeIngredientCost(4, 'cl', { unit: 'bottle', volume: 70, volumeUnit: 'cl', purchaseCost: 25 });
  const ananas = computeIngredientCost(2, 'cl', { unit: 'bottle', volume: 70, volumeUnit: 'cl', purchaseCost: 18 });
  const agave = computeIngredientCost(2, 'cl', { unit: 'bottle', volume: 100, volumeUnit: 'cl', purchaseCost: 12 });
  assert.equal(mundo.status, 'ok');
  assert.equal(ananas.status, 'ok');
  assert.equal(agave.status, 'ok');
  const total = mundo.cost + ananas.cost + agave.cost;
  assert.equal(total.toFixed(2), '2.18');
});

test('ingredient cost: same-unit direct costing (whole stock unit, e.g. 1 bottle)', () => {
  const item = { unit: 'bottle', volume: 70, volumeUnit: 'cl', purchaseCost: 25 };
  const { cost, status } = computeIngredientCost(1, 'bottle', item);
  assert.equal(status, 'ok');
  assert.equal(cost, 25);
});

test('ingredient cost: other-cost summation + total cost (spec example)', () => {
  const ingredientCost = 2.18;
  const pricing = computePricing({
    ingredientCost, wastageCost: 0.10, garnishCost: 0.15, otherCost: 0,
    sellingPrice: null, vatPercent: 0
  });
  assert.equal(pricing.otherCostsTotal.toFixed(2), '0.25');
  assert.equal(pricing.totalCost.toFixed(2), '2.43');
});

test('ingredient cost: missing purchase cost (NULL, not 0) is flagged, not silently 0', () => {
  const item = { unit: 'bottle', volume: 70, volumeUnit: 'cl', purchaseCost: null };
  const { cost, status } = computeIngredientCost(4, 'cl', item);
  assert.equal(status, 'missing_cost');
  assert.equal(cost, null);
});

test('ingredient cost: purchase cost of exactly 0 is a legitimate value, not "missing"', () => {
  const item = { unit: 'bottle', volume: 70, volumeUnit: 'cl', purchaseCost: 0 };
  const { cost, status } = computeIngredientCost(4, 'cl', item);
  assert.equal(status, 'ok');
  assert.equal(cost, 0);
});

test('ingredient cost: unlinked/custom ingredient (no item)', () => {
  const { cost, status } = computeIngredientCost(4, 'cl', null);
  assert.equal(status, 'not_linked');
  assert.equal(cost, null);
});

test('ingredient cost: unlinked/custom ingredient with a manually entered cost', () => {
  const { cost, status } = computeIngredientCost(4, 'cl', null, 0.30);
  assert.equal(status, 'ok');
  assert.equal(cost, 0.30);
});

test('ingredient cost: unlinked ingredient manual cost of exactly 0 is a legitimate value', () => {
  const { cost, status } = computeIngredientCost(4, 'cl', null, 0);
  assert.equal(status, 'ok');
  assert.equal(cost, 0);
});

test('ingredient cost: manualCost is ignored when an item is present (never a competing source)', () => {
  const item = { unit: 'bottle', volume: 70, volumeUnit: 'cl', purchaseCost: 25 };
  const { cost, status } = computeIngredientCost(4, 'cl', item, 999);
  assert.equal(status, 'ok');
  assert.equal(cost.toFixed(2), '1.43');
});

test('ingredient cost: incompatible/missing volume info is not convertible', () => {
  const item = { unit: 'bottle', volume: null, volumeUnit: null, purchaseCost: 25 };
  const { cost, status } = computeIngredientCost(4, 'cl', item);
  assert.equal(status, 'not_convertible');
  assert.equal(cost, null);
});

test('ingredient cost: recipe unit not ml/cl/L and not matching item unit -> not convertible', () => {
  const item = { unit: 'bottle', volume: 70, volumeUnit: 'cl', purchaseCost: 25 };
  const { cost, status } = computeIngredientCost(1, 'dash', item);
  assert.equal(status, 'not_convertible');
  assert.equal(cost, null);
});

// -------------------------------------------------------------------
// computePricing
// -------------------------------------------------------------------

test('pricing: selling price edit -> gross profit/margin (spec example)', () => {
  const p = computePricing({ ingredientCost: 2.18, wastageCost: 0.10, garnishCost: 0.15, otherCost: 0, sellingPrice: 8.90, vatPercent: 0 });
  assert.equal(p.totalCost.toFixed(2), '2.43');
  assert.equal(p.grossProfit.toFixed(2), '6.47');
  assert.equal((p.grossMargin * 100).toFixed(1), '72.7');
});

test('pricing: target-margin-derived selling price (spec example, computed via sellingPriceFromTargetMargin)', () => {
  const totalCost = 2.43;
  const sellingPrice = sellingPriceFromTargetMargin(totalCost, 0.70);
  assert.equal(sellingPrice.toFixed(2), '8.10');
  const p = computePricing({ ingredientCost: 2.18, wastageCost: 0.10, garnishCost: 0.15, otherCost: 0, sellingPrice, vatPercent: 0 });
  assert.equal(p.grossProfit.toFixed(2), '5.67');
  assert.equal((p.grossMargin * 100).toFixed(0), '70');
});

test('pricing: selling price edit never changes/derives target margin (they are independent inputs)', () => {
  // computePricing/sellingPriceFromTargetMargin never read or write a
  // "target margin" concept tied to sellingPrice - the caller is
  // responsible for leaving target_margin untouched on a Selling Price
  // save, which this asserts structurally: computing pricing from a
  // sellingPrice takes no targetMargin argument at all.
  const p = computePricing({ ingredientCost: 2.43, wastageCost: 0, garnishCost: 0, otherCost: 0, sellingPrice: 8.90, vatPercent: 0 });
  assert.ok(!('targetMargin' in p));
});

test('pricing: cost change never changes selling price - only recalculates dependent values (spec example)', () => {
  // Before: totalCost=2.43, sellingPrice=8.10 (from a 70% target margin)
  const before = computePricing({ ingredientCost: 2.18, wastageCost: 0.10, garnishCost: 0.15, otherCost: 0, sellingPrice: 8.10, vatPercent: 0 });
  assert.equal(before.totalCost.toFixed(2), '2.43');

  // Ingredient cost increases; selling price is NOT recalculated from
  // target margin - the same stored 8.10 is simply passed in again.
  const after = computePricing({ ingredientCost: 2.75, wastageCost: 0.10, garnishCost: 0.15, otherCost: 0, sellingPrice: 8.10, vatPercent: 0 });
  assert.equal(after.totalCost.toFixed(2), '3.00');
  assert.equal(after.grossProfit.toFixed(2), '5.10');
  assert.equal((after.grossMargin * 100).toFixed(2), '62.96');
});

test('pricing: VAT -> customer price (stored as percentage, e.g. 14 means 14%)', () => {
  const p = computePricing({ ingredientCost: 2.18, wastageCost: 0.10, garnishCost: 0.15, otherCost: 0, sellingPrice: 8.10, vatPercent: 14 });
  assert.equal(p.customerPrice.toFixed(2), '9.23');
});

test('pricing: VAT does not affect total cost or gross profit', () => {
  const noVat = computePricing({ ingredientCost: 2.18, wastageCost: 0.10, garnishCost: 0.15, otherCost: 0, sellingPrice: 8.10, vatPercent: 0 });
  const withVat = computePricing({ ingredientCost: 2.18, wastageCost: 0.10, garnishCost: 0.15, otherCost: 0, sellingPrice: 8.10, vatPercent: 14 });
  assert.equal(noVat.totalCost, withVat.totalCost);
  assert.equal(noVat.grossProfit, withVat.grossProfit);
  assert.equal(noVat.grossMargin, withVat.grossMargin);
});

test('pricing: zero VAT is valid, customer price equals selling price', () => {
  const p = computePricing({ ingredientCost: 1, wastageCost: 0, garnishCost: 0, otherCost: 0, sellingPrice: 5, vatPercent: 0 });
  assert.equal(p.customerPrice, 5);
});

test('pricing: selling price below total cost is allowed (negative gross profit)', () => {
  const p = computePricing({ ingredientCost: 5, wastageCost: 0, garnishCost: 0, otherCost: 0, sellingPrice: 3, vatPercent: 0 });
  assert.equal(p.grossProfit, -2);
  assert.ok(p.grossMargin < 0);
});

test('pricing: selling price equal to total cost -> zero gross profit/margin', () => {
  const p = computePricing({ ingredientCost: 3, wastageCost: 0, garnishCost: 0, otherCost: 0, sellingPrice: 3, vatPercent: 0 });
  assert.equal(p.grossProfit, 0);
  assert.equal(p.grossMargin, 0);
});

test('pricing: zero-cost recipe with positive selling price -> 100% margin, no divide-by-zero', () => {
  const p = computePricing({ ingredientCost: 0, wastageCost: 0, garnishCost: 0, otherCost: 0, sellingPrice: 5, vatPercent: 0 });
  assert.equal(p.totalCost, 0);
  assert.equal(p.grossProfit, 5);
  assert.equal(p.grossMargin, 1);
});

test('pricing: no selling price -> derived values are null, not 0/NaN (edge case: target margin set, selling price null)', () => {
  const p = computePricing({ ingredientCost: 2, wastageCost: 0, garnishCost: 0, otherCost: 0, sellingPrice: null, vatPercent: 14 });
  assert.equal(p.grossProfit, null);
  assert.equal(p.grossMargin, null);
  assert.equal(p.customerPrice, null);
});

// -------------------------------------------------------------------
// sellingPriceFromTargetMargin
// -------------------------------------------------------------------

test('sellingPriceFromTargetMargin: invalid margin (>=100%) rejected, no divide-by-zero/negative', () => {
  assert.equal(sellingPriceFromTargetMargin(2.43, 1), null);
  assert.equal(sellingPriceFromTargetMargin(2.43, 1.5), null);
});

test('sellingPriceFromTargetMargin: negative margin rejected', () => {
  assert.equal(sellingPriceFromTargetMargin(2.43, -0.1), null);
});

test('sellingPriceFromTargetMargin: 0% margin -> selling price equals total cost', () => {
  assert.equal(sellingPriceFromTargetMargin(2.43, 0), 2.43);
});

test('sellingPriceFromTargetMargin: null/undefined margin -> null (no forced recompute)', () => {
  assert.equal(sellingPriceFromTargetMargin(2.43, null), null);
  assert.equal(sellingPriceFromTargetMargin(2.43, undefined), null);
});

// -------------------------------------------------------------------
// Rounding / decimal precision
// -------------------------------------------------------------------

test('rounding: full precision is kept internally, only display formatting rounds', () => {
  const item = { unit: 'bottle', volume: 70, volumeUnit: 'cl', purchaseCost: 25 };
  const { cost } = computeIngredientCost(4, 'cl', item);
  // The raw value is not pre-rounded to 2dp.
  assert.notEqual(cost, 1.43);
  assert.equal(Number(cost.toFixed(2)), 1.43);
});
