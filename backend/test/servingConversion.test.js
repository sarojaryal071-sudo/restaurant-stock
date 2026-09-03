'use strict';

/**
 * Tests for the serving-unit conversion feature approved in the
 * "Serving Unit Upgrade" task.
 *
 * Uses Node's built-in test runner (node:test) - no new dependency.
 * amountToMl / stockUnitsFromSalesServing are the existing, unmodified
 * conversion functions in ../recipes.js; this suite verifies the new
 * caller behavior around them without re-implementing any calculation.
 *
 * Run with: node --test test/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { amountToMl, stockUnitsFromSalesServing } = require('../recipes');

test('Test 1 - Draught: 6 glasses x 0.4 L against a 30 L keg = 0.08 keg', () => {
  const result = stockUnitsFromSalesServing(6, 0.4, 'L', 30, 'L', 'keg');
  assert.equal(result, 0.08);
});

test('Test 2 - Tequila: 6 shots x 4 cl against a 700 ml bottle = correct fraction', () => {
  const result = stockUnitsFromSalesServing(6, 4, 'cl', 700, 'ml', 'bottle');
  // (6 * 40ml) / 700ml
  assert.ok(Math.abs(result - (240 / 700)) < 1e-9, `expected ~0.342857, got ${result}`);
});

test('Test 3 - Serving unit equals stock unit: direct multiply, no physical volume needed', () => {
  // e.g. a spirit counted directly in "cl" rather than "bottle"
  const result = stockUnitsFromSalesServing(6, 4, 'cl', null, null, 'cl');
  assert.equal(result, 24);
});

test('Test 4 - No serving configuration: helper signals "not applicable" via null', () => {
  // Mirrors the guard in posSalesImport.repository.js
  // (`dbItem.sales_volume != null && dbItem.sales_volume_unit`) that
  // skips calling this function entirely when no serving is configured -
  // when called anyway with nothing set, it must return null, not a
  // number, so the caller never mistakes "unset" for "zero deduction".
  const result = stockUnitsFromSalesServing(3, null, null, null, null, 'bottle');
  assert.equal(result, null);
});

test('Test 5 - Missing physical stock volume: conversion refuses to guess', () => {
  // Serving unit ("cl") differs from the stock unit ("bottle") and the
  // item's physical Volume/Volume Unit are missing - must return null,
  // never a number that could be mistaken for stock units.
  const result = stockUnitsFromSalesServing(6, 4, 'cl', null, null, 'bottle');
  assert.equal(result, null);
});

test('Test 5b - applyImport hardening: throws instead of silently falling back', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'posSalesImport', 'posSalesImport.repository.js'),
    'utf8'
  );
  // The configured-serving branch (Unit selected == item's own
  // serving_name) must throw SERVING_CONVERSION_FAILED on a failed
  // conversion rather than falling through to stockReduction = quantitySold.
  const branchMatch = src.match(/if \(isConfiguredServing\)[\s\S]*?\n    \}/);
  assert.ok(branchMatch, 'configured-serving conversion branch not found in applyImport');
  assert.match(
    branchMatch[0],
    /throw \{\s*code: 'SERVING_CONVERSION_FAILED'/,
    'branch must throw SERVING_CONVERSION_FAILED on a failed conversion rather than falling through to stockReduction = quantitySold'
  );
});

test('Test 6 - Recipe isolation: applyRecipeSaleTx never reads sales_volume or serving_name', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'recipes.js'), 'utf8');
  const start = src.indexOf('async function applyRecipeSaleTx');
  const end = src.indexOf('async function recordSale');
  assert.ok(start !== -1 && end !== -1 && end > start, 'applyRecipeSaleTx function not found in recipes.js');
  const fnBody = src.slice(start, end);
  assert.ok(
    !/sales_volume/.test(fnBody),
    'applyRecipeSaleTx must not reference sales_volume - recipe deductions use recipe_ingredients.amount/unit only'
  );
  assert.ok(
    !/serving_name/.test(fnBody),
    'applyRecipeSaleTx must not reference serving_name - it is direct-sale metadata only'
  );
});

test('amountToMl: ml/cl/L conversions are unchanged', () => {
  assert.equal(amountToMl(40, 'ml'), 40);
  assert.equal(amountToMl(4, 'cl'), 40);
  assert.equal(amountToMl(0.4, 'L'), 400);
  assert.equal(amountToMl(5, 'bottle'), null);
});
