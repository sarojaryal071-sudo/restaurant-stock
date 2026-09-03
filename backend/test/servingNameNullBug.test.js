'use strict';

/**
 * Tests for the "Serving as" field reverting to the literal text "null"
 * after being cleared and saved (reported live: Corona bottle beer, but
 * not specific to that item - any item's cleared serving name was
 * affected).
 *
 * Root cause: updateItem's clear-the-field logic ran `String(servingName)`
 * on a value that can legitimately be `null` (an explicit clear, sent by
 * the frontend as JSON null). In JavaScript, String(null) is the literal
 * text "null", not an empty string - `"null".trim() || null` never
 * reaches the `|| null` fallback because "null" is a non-empty, truthy
 * string. That literal text got saved to the database as if it were a
 * real serving name, and every read path (`it.servingName || ''`, the
 * suggestions datalist's `.filter(Boolean)`, etc.) treats a non-empty
 * string as a real value - so it reappeared after every refresh.
 *
 * resolveServingName is exported specifically so this can be tested as a
 * pure function, without a live database (unavailable in this sandbox -
 * see this session's earlier investigations).
 *
 * Run with: node --test test/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { resolveServingName } = require('../inventory');

test('Clearing the field with an explicit null produces a real null, not the string "null"', () => {
  const result = resolveServingName(null, 'Glass');
  assert.equal(result, null);
  assert.notEqual(result, 'null', 'must never be the literal text "null"');
});

test('Clearing the field with an empty string produces null', () => {
  assert.equal(resolveServingName('', 'Glass'), null);
});

test('Clearing the field with whitespace-only text produces null', () => {
  assert.equal(resolveServingName('   ', 'Glass'), null);
});

test('Omitting the field entirely (undefined) preserves the existing value unchanged', () => {
  assert.equal(resolveServingName(undefined, 'Glass'), 'Glass');
});

test('Omitting the field when there was no existing value stays null', () => {
  assert.equal(resolveServingName(undefined, null), null);
});

test('Setting a real serving name still works normally', () => {
  assert.equal(resolveServingName('Shot', null), 'Shot');
  assert.equal(resolveServingName('  Pint  ', null), 'Pint');
});

test('Structural: updateItem computes serving_name via resolveServingName, not an inline String(x) call', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'inventory.js'), 'utf8');
  const fnMatch = src.match(/async function updateItem[\s\S]*?\n}\n/);
  assert.ok(fnMatch, 'updateItem not found');
  assert.match(fnMatch[0], /resolveServingName\(servingName/, 'updateItem must delegate to resolveServingName');
  assert.ok(!/String\(servingName\)/.test(fnMatch[0]), 'updateItem must never call String() directly on a possibly-null servingName');
});

test('Structural: the same null->"null" pattern is also guarded for item and category names', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'inventory.js'), 'utf8');
  // Both updateItem's and updateCategory's name fields are optional on
  // update (name !== undefined ? ... : existing name) and go through the
  // exact same "String() on a value that can be null" shape - guarded
  // with `name || ''` so an explicit null can never survive as the
  // literal text "null" (which would also bypass the "cannot be empty"
  // check, since a non-empty string is truthy).
  const bareStringOnName = /name !== undefined \? String\(name\)\.trim\(\)/;
  assert.ok(!bareStringOnName.test(src), 'no remaining unguarded String(name).trim() on an optional name field');
});

test('Migration: the historical-data repair targets the exact corrupted value, generically, across every item', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'migration.js'), 'utf8');
  assert.match(src, /UPDATE items SET serving_name = NULL WHERE serving_name = 'null'/,
    'migration.js must repair any item whose serving_name literally equals the text "null"');
  // Must not be scoped to a specific item, name, or restaurant.
  const repairLine = src.match(/UPDATE items SET serving_name = NULL WHERE serving_name = 'null'[^;]*/)[0];
  assert.ok(!/id = |restaurant_id = |name = 'Corona|klandestina/i.test(repairLine),
    'the repair must apply generically, not to a specific item/restaurant');
});
