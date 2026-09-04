const { query } = require('./database');
const { amountToMl } = require('./recipes');

// -------------------------------------------------------------------
// computeIngredientCost
// -------------------------------------------------------------------
// Pure function: cost of a single recipe ingredient line, given the
// recipe amount/unit and the linked item's costing/volume info.
//
// item is either null (no linked inventory item / custom ingredient) or
// { unit, volume, volumeUnit, purchaseCost }, where purchaseCost is the
// price of ONE physical stock unit of `item.unit` (e.g. one bottle).
//
// Reuses amountToMl (backend/recipes.js) for the same-unit-else-volume
// conversion shape already established by stockUnitsFromServing /
// stockUnitsFromSalesServing - no second conversion system.
//
// Returns { cost, status }:
//   status 'ok'              -> cost is a number
//   status 'not_linked'      -> custom/unlinked ingredient, no item to cost
//   status 'missing_cost'    -> item exists but purchaseCost is NULL
//                                (distinct from a legitimate 0)
//   status 'not_convertible' -> units are incompatible / item has no
//                                usable volume info
//   status 'invalid_amount'  -> the recipe amount itself is not a valid
//                                non-negative number
// cost is null whenever status !== 'ok'. Never silently returns a wrong
// number.
// -------------------------------------------------------------------
function computeIngredientCost(amount, unit, item) {
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt < 0) {
    return { cost: null, status: 'invalid_amount' };
  }

  if (!item) {
    return { cost: null, status: 'not_linked' };
  }

  // Distinguish "not configured" (null/undefined) from a legitimate 0.
  const purchaseCost = item.purchaseCost;
  if (purchaseCost === null || purchaseCost === undefined) {
    return { cost: null, status: 'missing_cost' };
  }

  const normRecipeUnit = String(unit || '').trim().toLowerCase();
  const normItemUnit = String(item.unit || '').trim().toLowerCase();

  // Same-unit direct costing: the recipe uses whole stock units of this
  // item (e.g. "1 bottle"), so the purchase cost applies directly - no
  // volume conversion needed or possible (a bottle isn't a ml amount).
  if (normRecipeUnit && normItemUnit && normRecipeUnit === normItemUnit) {
    return { cost: purchaseCost * amt, status: 'ok' };
  }

  // Otherwise, cost via the item's physical volume, mirroring
  // stockUnitsFromServing's same shape: amountToMl the recipe usage and
  // the item's container volume, take cost-per-ml, multiply.
  const recipeMl = amountToMl(amt, unit);
  const itemVolumeMl = amountToMl(item.volume, item.volumeUnit);
  if (recipeMl === null || itemVolumeMl === null || itemVolumeMl <= 0) {
    return { cost: null, status: 'not_convertible' };
  }

  const costPerMl = purchaseCost / itemVolumeMl;
  return { cost: costPerMl * recipeMl, status: 'ok' };
}

// -------------------------------------------------------------------
// computePricing
// -------------------------------------------------------------------
// Pure function. Derives every non-persisted value from the persisted
// raw inputs. Never derives sellingPrice from targetMargin here - that
// conversion only happens as the direct, explicit effect of a user
// editing Target Margin (handled by the frontend / by the caller of
// saveRecipeCosting, never silently on read).
//
// vatPercent is the actual percentage number (14 means 14%), not a
// fraction - Customer Price = sellingPrice * (1 + vatPercent / 100).
// targetMargin remains a fraction (0.70 = 70%) - it is only used here
// for validation context, not to compute sellingPrice.
// -------------------------------------------------------------------
function computePricing({ ingredientCost, wastageCost, garnishCost, otherCost, sellingPrice, vatPercent }) {
  const otherCostsTotal = (wastageCost || 0) + (garnishCost || 0) + (otherCost || 0);
  const totalCost = (ingredientCost || 0) + otherCostsTotal;

  const hasSellingPrice = sellingPrice !== null && sellingPrice !== undefined;
  const grossProfit = hasSellingPrice ? sellingPrice - totalCost : null;
  const grossMargin = (hasSellingPrice && sellingPrice > 0) ? grossProfit / sellingPrice : null;
  const customerPrice = hasSellingPrice ? sellingPrice * (1 + ((vatPercent || 0) / 100)) : null;

  return { otherCostsTotal, totalCost, grossProfit, grossMargin, customerPrice };
}

// -------------------------------------------------------------------
// sellingPriceFromTargetMargin
// -------------------------------------------------------------------
// Selling Price = Total Cost / (1 - Target Margin). Only ever invoked as
// the direct result of an explicit Target Margin save - never on plain
// read. Returns null if the margin is out of the valid [0, 1) range
// (division would be undefined or negative at/above 100%).
// -------------------------------------------------------------------
function sellingPriceFromTargetMargin(totalCost, targetMargin) {
  if (targetMargin === null || targetMargin === undefined) return null;
  if (isNaN(targetMargin) || targetMargin < 0 || targetMargin >= 1) return null;
  return totalCost / (1 - targetMargin);
}

// -------------------------------------------------------------------
// getRecipeCost
// -------------------------------------------------------------------
async function getRecipeCost(req, res) {
  const { restaurantId } = req.auth;
  const recipeId = req.body.recipeId || req.query.recipeId;

  if (!recipeId) return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Missing recipeId' });

  try {
    const recipe = await query(`SELECT id FROM recipes WHERE id = $1 AND restaurant_id = $2`, [recipeId, restaurantId]);
    if (recipe.rows.length === 0) return res.json({ ok: false, code: 'NOT_FOUND', error: 'Recipe not found' });

    const ingRows = await query(
      `SELECT ri.id, ri.inventory_item_id, ri.ingredient_name, ri.amount, ri.unit,
              i.name AS item_name, i.unit AS item_unit, i.volume, i.volume_unit, i.purchase_cost
       FROM recipe_ingredients ri
       LEFT JOIN items i ON i.id = ri.inventory_item_id
       WHERE ri.recipe_id = $1`,
      [recipeId]
    );

    let ingredientCost = 0;
    const ingredients = ingRows.rows.map(row => {
      const amount = parseFloat(row.amount);
      const item = row.inventory_item_id ? {
        unit: row.item_unit,
        volume: row.volume !== null ? parseFloat(row.volume) : null,
        volumeUnit: row.volume_unit,
        purchaseCost: row.purchase_cost !== null && row.purchase_cost !== undefined ? parseFloat(row.purchase_cost) : null
      } : null;

      const { cost, status } = computeIngredientCost(amount, row.unit, item);
      if (status === 'ok') ingredientCost += cost;

      return {
        id: row.id,
        inventoryItemId: row.inventory_item_id || null,
        name: row.inventory_item_id ? row.item_name : row.ingredient_name,
        amount,
        unit: row.unit,
        cost,
        status,
        // Already-fetched cost-basis fields (no new query, no new
        // calculation) - purely so the UI can display "€25.00 / 70 cl"
        // style basis text without recomputing it client-side.
        itemUnit: item ? item.unit : null,
        itemVolume: item ? item.volume : null,
        itemVolumeUnit: item ? item.volumeUnit : null,
        purchaseCost: item ? item.purchaseCost : null
      };
    });

    const costRow = await query(`SELECT * FROM recipe_costs WHERE recipe_id = $1`, [recipeId]);
    const cfg = costRow.rows.length > 0 ? costRow.rows[0] : null;

    const wastageCost = cfg ? parseFloat(cfg.wastage_cost) : 0;
    const garnishCost = cfg ? parseFloat(cfg.garnish_cost) : 0;
    const otherCost = cfg ? parseFloat(cfg.other_cost) : 0;
    const targetMargin = cfg && cfg.target_margin !== null ? parseFloat(cfg.target_margin) : null;
    const sellingPrice = cfg && cfg.selling_price !== null ? parseFloat(cfg.selling_price) : null;
    const vatPercent = cfg ? parseFloat(cfg.vat_percent) : 0;

    const derived = computePricing({ ingredientCost, wastageCost, garnishCost, otherCost, sellingPrice, vatPercent });

    res.json({
      ok: true,
      recipeId,
      ingredients,
      ingredientCost,
      wastageCost,
      garnishCost,
      otherCost,
      otherCostsTotal: derived.otherCostsTotal,
      totalCost: derived.totalCost,
      targetMargin,
      sellingPrice,
      vatPercent,
      grossProfit: derived.grossProfit,
      grossMargin: derived.grossMargin,
      customerPrice: derived.customerPrice
    });
  } catch (err) {
    console.error('getRecipeCost error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

// -------------------------------------------------------------------
// saveRecipeCosting
// -------------------------------------------------------------------
// Persists only raw inputs. If targetMargin is provided, sellingPrice is
// expected to be supplied alongside it by the caller (the frontend
// computes Selling Price = Total Cost / (1 - Target Margin) at the
// moment the user edits Target Margin, and saves both together) - this
// handler does not itself recompute sellingPrice from targetMargin, so
// a cost change on a later save never silently moves a previously
// saved sellingPrice.
// -------------------------------------------------------------------
async function saveRecipeCosting(req, res) {
  const { restaurantId } = req.auth;
  const {
    recipeId,
    wastageCost,
    garnishCost,
    otherCost,
    targetMargin,
    sellingPrice,
    vatPercent
  } = req.body;

  if (!recipeId) return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Missing recipeId' });

  try {
    const recipe = await query(`SELECT id FROM recipes WHERE id = $1 AND restaurant_id = $2`, [recipeId, restaurantId]);
    if (recipe.rows.length === 0) return res.json({ ok: false, code: 'NOT_FOUND', error: 'Recipe not found' });

    function toNonNegative(value, fieldLabel) {
      if (value === undefined || value === null || value === '') return 0;
      const n = parseFloat(value);
      if (isNaN(n) || n < 0) throw { code: 'VALIDATION_ERROR', error: `${fieldLabel} must be a non-negative number.` };
      return n;
    }

    const newWastageCost = toNonNegative(wastageCost, 'Wastage');
    const newGarnishCost = toNonNegative(garnishCost, 'Garnish');
    const newOtherCost = toNonNegative(otherCost, 'Other cost');

    let newTargetMargin = null;
    if (targetMargin !== undefined && targetMargin !== null && targetMargin !== '') {
      newTargetMargin = parseFloat(targetMargin);
      if (isNaN(newTargetMargin) || newTargetMargin < 0 || newTargetMargin >= 1) {
        return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Target Margin must be between 0% and 100% (exclusive).' });
      }
    }

    let newSellingPrice = null;
    if (sellingPrice !== undefined && sellingPrice !== null && sellingPrice !== '') {
      newSellingPrice = parseFloat(sellingPrice);
      if (isNaN(newSellingPrice) || newSellingPrice <= 0) {
        return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'Selling Price must be greater than 0.' });
      }
    }

    let newVatPercent = 0;
    if (vatPercent !== undefined && vatPercent !== null && vatPercent !== '') {
      newVatPercent = parseFloat(vatPercent);
      if (isNaN(newVatPercent) || newVatPercent < 0) {
        return res.json({ ok: false, code: 'VALIDATION_ERROR', error: 'VAT must be a non-negative number.' });
      }
    }

    await query(
      `INSERT INTO recipe_costs (recipe_id, wastage_cost, garnish_cost, other_cost, target_margin, selling_price, vat_percent, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (recipe_id) DO UPDATE SET
         wastage_cost = EXCLUDED.wastage_cost,
         garnish_cost = EXCLUDED.garnish_cost,
         other_cost = EXCLUDED.other_cost,
         target_margin = EXCLUDED.target_margin,
         selling_price = EXCLUDED.selling_price,
         vat_percent = EXCLUDED.vat_percent,
         updated_at = NOW()`,
      [recipeId, newWastageCost, newGarnishCost, newOtherCost, newTargetMargin, newSellingPrice, newVatPercent]
    );

    // Re-derive and return the full costing view, same shape as getRecipeCost,
    // so the frontend can re-render from this single response.
    req.body.recipeId = recipeId;
    return getRecipeCost(req, res);
  } catch (err) {
    if (err && err.code === 'VALIDATION_ERROR') {
      return res.json({ ok: false, code: err.code, error: err.error });
    }
    console.error('saveRecipeCosting error:', err);
    res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: err.message });
  }
}

module.exports = {
  computeIngredientCost,
  computePricing,
  sellingPriceFromTargetMargin,
  getRecipeCost,
  saveRecipeCosting
};
