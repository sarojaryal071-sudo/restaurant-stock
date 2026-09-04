'use strict';

async function loadRecipes() {
  try {
    const d = await api.listRecipes();
    recipeState.recipes = (d && Array.isArray(d.recipes)) ? d.recipes : (d && Array.isArray(d) ? d : []);
    renderRecipes();
    // Preload costing for every recipe as part of this same load, same
    // as auth.js's preloadWorkspace() does on login/session restore -
    // not awaited, so the Ingredients view above never waits on it.
    loadRecipeCostsFor(recipeState.recipes);
  } catch (e) {
    toast('Could not load recipes.', true);
  }
}

// Fetches getRecipeCost for each given recipe in parallel and caches the
// results in recipeState.costs, keyed by recipe id. This is the single
// place both entry points that populate recipeState.recipes (this file's
// loadRecipes, and auth.js's preloadWorkspace on login/session restore)
// trigger a costing preload from, so Cost data is initialized as part of
// the normal recipe lifecycle instead of a separate per-tab-click fetch.
// Failures are left uncached rather than surfaced - the Cost tab falls
// back to fetching that one recipe on demand if it's opened before this
// resolves (see fetchRecipeCostPane).
async function loadRecipeCostsFor(recipes) {
  const list = Array.isArray(recipes) ? recipes : [];
  await Promise.allSettled(list.map(async r => {
    try {
      recipeState.costs[r.id] = await api.getRecipeCost(r.id);
    } catch (e) { /* left uncached; on-demand fallback covers this */ }
  }));
}

function renderRecipes() {
  const root = document.getElementById('recipesRoot');
  root.innerHTML = '';
  const sorted = [...recipeState.recipes].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  sorted.forEach(r => root.appendChild(renderRecipeCard(r)));
  document.getElementById('recipesEmptyHero').classList.toggle('show', recipeState.recipes.length === 0);
  applyRecipeSearch();
}

function renderRecipeCard(r) {
  const card = document.createElement('div');
  card.className = 'cat-card';
  card.dataset.recipeId = r.id;
  card.dataset.recipeName = (r.name || '').toLowerCase();
  const h = document.createElement('button');
  h.className = 'cat-header';
  h.setAttribute('aria-expanded', 'false');
  const ic = (r.ingredients || []).length;
  h.innerHTML = `<div class="cat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3h8l1 6a4 4 0 0 1-8 0L8 3z"/><path d="M12 13v5"/><path d="M8 21h8"/></svg></div><div class="cat-title-wrap"><div class="cat-name">${escapeHtml(r.name || 'Unnamed')}</div><div class="cat-count"><b>${ic}</b> ingredient${ic === 1 ? '' : 's'}</div></div><svg class="cat-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>`;
  h.addEventListener('click', () => {
    card.classList.toggle('expanded');
    h.setAttribute('aria-expanded', card.classList.contains('expanded') ? 'true' : 'false');
  });
  const body = document.createElement('div');
  body.className = 'cat-body';
  const bi = document.createElement('div');
  bi.className = 'cat-body-inner';

  let dh = '';
  if (r.glass) dh += `<div class="recipe-detail"><strong>Glass</strong><br>${escapeHtml(r.glass)}</div>`;
  if (r.method) dh += `<div class="recipe-detail"><strong>Method</strong><br>${escapeHtml(r.method).replace(/\n/g, '<br>')}</div>`;
  if (r.garnish) dh += `<div class="recipe-detail"><strong>Garnish</strong><br>${escapeHtml(r.garnish)}</div>`;
  if (r.ingredients && r.ingredients.length > 0) {
    dh += '<div class="recipe-detail"><strong>Ingredients</strong>';
    r.ingredients.forEach(ing => {
      const nm = ing.inventoryItemName || ing.customName || 'Unknown';
      dh += `<div class="ingredient-row"><span>${escapeHtml(nm)}</span> ${ing.amount || ''} ${escapeHtml(ing.unit || '')}</div>`;
    });
    dh += '</div>';
  }
  const editAllowed = can('recipes', 'edit');
  const deleteAllowed = can('recipes', 'delete');
  if (editAllowed || deleteAllowed) {
    dh += '<div class="recipe-card-actions">';
    if (editAllowed) dh += '<button class="btn btn-gold btn-small edit-recipe-btn">Edit</button>';
    if (deleteAllowed) dh += '<button class="btn btn-danger btn-small delete-recipe-btn">Delete</button>';
    dh += '</div>';
  }

  // [Ingredients] [Cost] tabs. The Ingredients pane above is completely
  // unchanged; Cost is a sibling pane, lazy-loaded on first open.
  bi.innerHTML = `
    <div class="segmented-control recipe-tab-control">
      <button type="button" class="segmented-btn active" data-tab="ingredients">Ingredients</button>
      <button type="button" class="segmented-btn" data-tab="cost">Cost</button>
    </div>
    <div class="recipe-tab-pane" data-pane="ingredients">${dh}</div>
    <div class="recipe-tab-pane" data-pane="cost" hidden></div>
  `;
  body.appendChild(bi);
  bi.querySelector('.edit-recipe-btn')?.addEventListener('click', ev => { ev.stopPropagation(); openRecipeModal(r); });
  bi.querySelector('.delete-recipe-btn')?.addEventListener('click', ev => { ev.stopPropagation(); delRecipe(r); });

  const tabBtns = bi.querySelectorAll('.recipe-tab-control .segmented-btn');
  const ingPane = bi.querySelector('.recipe-tab-pane[data-pane="ingredients"]');
  const costPane = bi.querySelector('.recipe-tab-pane[data-pane="cost"]');

  // Costing data is preloaded as part of the normal recipe load lifecycle
  // (see loadRecipeCostsFor) rather than fetched when the tab is opened.
  // If it's already in recipeState.costs, render it now so the pane is
  // ready before the user ever clicks "Cost" - the click handler below
  // only has to fall back to an on-demand fetch on a cache miss (e.g. a
  // recipe created after the preload ran, or a slow/failed preload).
  if (recipeState.costs[r.id]) {
    renderRecipeCostPane(costPane, r.id, recipeState.costs[r.id]);
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.stopPropagation();
      tabBtns.forEach(b => b.classList.toggle('active', b === btn));
      const tab = btn.dataset.tab;
      ingPane.hidden = tab !== 'ingredients';
      costPane.hidden = tab !== 'cost';
      if (tab === 'cost' && !costPane.dataset.rendered) {
        fetchRecipeCostPane(r.id, costPane);
      }
    });
  });

  card.appendChild(h);
  card.appendChild(body);
  return card;
}

// -------------------------------------------------------------------
// Recipe Cost tab
// -------------------------------------------------------------------
// Costing data lives in recipeState.costs (recipe id -> last-loaded
// getRecipeCost() response) - the same state object/lifecycle Recipe
// ingredients already use (recipeState.recipes), populated by
// loadRecipeCostsFor() as part of the normal recipe-load flow rather
// than a separate cache fetched only when the Cost tab is opened.

function fmtMoney(n) {
  return (n === null || n === undefined || isNaN(n)) ? '—' : '€' + Number(n).toFixed(2);
}

function fmtPercent(fraction) {
  return (fraction === null || fraction === undefined || isNaN(fraction)) ? '—' : (fraction * 100).toFixed(1) + '%';
}

const ING_STATUS_LABEL = {
  missing_cost: 'Cost not set',
  not_convertible: 'Needs item Volume set',
  invalid_amount: 'Invalid amount'
};

// Formats the "€25.00 / 70 cl" (or "€25.00 / bottle") cost-basis text
// from the already-fetched, already-computed fields getRecipeCost
// returns per ingredient - no extra request, no recomputation.
function ingredientBasisText(ing) {
  if (ing.purchaseCost === null || ing.purchaseCost === undefined) return '';
  const priceStr = fmtMoney(ing.purchaseCost);
  const recipeUnitNorm = String(ing.unit || '').trim().toLowerCase();
  const itemUnitNorm = String(ing.itemUnit || '').trim().toLowerCase();
  if (recipeUnitNorm && itemUnitNorm && recipeUnitNorm === itemUnitNorm) {
    return `${priceStr} / ${ing.itemUnit}`;
  }
  if (ing.itemVolume !== null && ing.itemVolume !== undefined && ing.itemVolumeUnit) {
    return `${priceStr} / ${ing.itemVolume} ${ing.itemVolumeUnit}`;
  }
  return '';
}

// On-demand fallback fetch: only reached when a recipe's cost wasn't
// already preloaded (recipeState.costs cache miss) - e.g. a recipe
// created after the initial load, or the background preload hasn't
// resolved yet. Normal tab switches never reach this.
async function fetchRecipeCostPane(recipeId, paneEl) {
  paneEl.innerHTML = '<div class="recipe-cost-loading">Loading…</div>';
  try {
    const data = await api.getRecipeCost(recipeId);
    recipeState.costs[recipeId] = data;
    renderRecipeCostPane(paneEl, recipeId, data);
  } catch (e) {
    paneEl.innerHTML = `<div class="recipe-cost-loading">${escapeHtml(e.message || 'Could not load costing.')}</div>`;
  }
}

// Re-fetches and re-renders one recipe's costing (used after an action
// that changes it outside of the Save Costing button, e.g. setting an
// item's purchase cost inline).
async function refreshRecipeCostPane(recipeId, paneEl) {
  try {
    const data = await api.getRecipeCost(recipeId);
    recipeState.costs[recipeId] = data;
    renderRecipeCostPane(paneEl, recipeId, data);
  } catch (e) {
    toast(e.message || 'Could not refresh costing.', true);
  }
}

function renderRecipeCostPane(paneEl, recipeId, data) {
  const editAllowed = can('recipes', 'edit');
  const itemEditAllowed = can('inventory', 'edit');

  let ingHtml = '<div class="recipe-detail recipe-cost-section"><strong>Ingredient Cost</strong><div class="recipe-cost-ing-list">';
  (data.ingredients || []).forEach(ing => {
    const isCustom = !ing.inventoryItemId;
    const basis = ing.status === 'ok' ? ingredientBasisText(ing) : '';

    // Row + its optional inline "set cost" editor are grouped in one
    // container so the editor visually belongs to this ingredient, not
    // a stray row between it and the next one.
    ingHtml += '<div class="recipe-cost-ing-item">';
    ingHtml += '<div class="recipe-cost-ing-row" data-ing-id="' + escapeHtml(ing.id) + '">';
    ingHtml += '<div class="recipe-cost-ing-info">';
    ingHtml += `<span><span class="recipe-cost-ing-name">${escapeHtml(ing.name || 'Unknown')}</span> <span class="recipe-cost-ing-qty">${ing.amount ?? ''} ${escapeHtml(ing.unit || '')}</span></span>`;
    if (basis) ingHtml += `<span class="recipe-cost-ing-basis">${escapeHtml(basis)}</span>`;
    ingHtml += '</div>';
    ingHtml += '<div class="recipe-cost-ing-right">';
    if (ing.status === 'ok') {
      ingHtml += `<span class="recipe-cost-ing-value">${fmtMoney(ing.cost)}</span>`;
    } else if (ing.status !== 'not_linked') {
      const label = ING_STATUS_LABEL[ing.status] || 'Unavailable';
      ingHtml += `<span class="recipe-cost-badge recipe-cost-badge-warning">${escapeHtml(label)}</span>`;
    }
    // "Not in inventory" is informational, not a warning - shown
    // whenever the ingredient is custom/unlinked, whether or not a
    // manual cost has been entered for it yet.
    if (isCustom) {
      ingHtml += `<span class="recipe-cost-badge recipe-cost-badge-neutral">Not in inventory</span>`;
    }
    ingHtml += '</div></div>';

    if (ing.status === 'missing_cost' && ing.inventoryItemId && itemEditAllowed) {
      ingHtml += `<div class="recipe-cost-set-cost"><div class="field-input-group has-prefix"><span class="field-affix">€</span><input type="number" min="0" step="0.01" class="field-input ing-set-cost-input" placeholder="0.00"></div><button type="button" class="btn btn-ghost btn-small ing-set-cost-btn" data-item-id="${escapeHtml(ing.inventoryItemId)}">Save</button></div>`;
    } else if (isCustom && editAllowed) {
      // Custom ingredients have no items row to attach a cost to, so the
      // cost is entered directly on this recipe's ingredient line
      // (recipe_ingredients.manual_cost) instead of via Inventory.
      const prefill = (ing.manualCost !== null && ing.manualCost !== undefined) ? ing.manualCost : '';
      ingHtml += `<div class="recipe-cost-set-cost"><div class="field-input-group has-prefix"><span class="field-affix">€</span><input type="number" min="0" step="0.01" class="field-input ing-set-manual-cost-input" placeholder="0.00" value="${prefill}"></div><button type="button" class="btn btn-ghost btn-small ing-set-manual-cost-btn" data-ingredient-id="${escapeHtml(ing.id)}">Save</button></div>`;
    }
    ingHtml += '</div>';
  });
  ingHtml += `</div><div class="recipe-cost-total-row"><span>Ingredient Cost</span><span>${fmtMoney(data.ingredientCost)}</span></div></div>`;

  let otherHtml = '<div class="recipe-detail recipe-cost-section"><strong>Other Costs</strong><div class="recipe-cost-field-grid">';
  otherHtml += costFieldHtml('Wastage', 'wastage', data.wastageCost, editAllowed, '€', 'prefix', 2);
  otherHtml += costFieldHtml('Garnish', 'garnish', data.garnishCost, editAllowed, '€', 'prefix', 2);
  otherHtml += costFieldHtml('Other', 'other', data.otherCost, editAllowed, '€', 'prefix', 2);
  otherHtml += `</div><div class="recipe-cost-total-row"><span>Other Costs</span><span class="recipe-cost-other-total">${fmtMoney(data.otherCostsTotal)}</span></div></div>`;

  const totalHtml = `<div class="recipe-cost-grand-total"><span class="recipe-cost-grand-total-label">Total Cost</span><span class="recipe-cost-grand-total-value recipe-cost-total-value">${fmtMoney(data.totalCost)}</span></div>`;

  const targetMarginPct = data.targetMargin !== null && data.targetMargin !== undefined ? (data.targetMargin * 100) : '';
  let pricingHtml = '<div class="recipe-detail recipe-cost-section"><strong>Pricing</strong><div class="recipe-cost-field-grid">';
  pricingHtml += costFieldHtml('Target Margin', 'targetMargin', targetMarginPct, editAllowed, '%', 'suffix', 1);
  pricingHtml += costFieldHtml('Selling Price', 'sellingPrice', data.sellingPrice, editAllowed, '€', 'prefix', 2);
  pricingHtml += costFieldHtml('VAT', 'vatPercent', data.vatPercent, editAllowed, '%', 'suffix', 1);
  pricingHtml += '</div><div class="recipe-cost-readout-grid">';
  pricingHtml += `<div class="recipe-cost-readout"><span class="field-label">Customer Price</span><span class="recipe-cost-customer-price recipe-cost-readout-value">${fmtMoney(data.customerPrice)}</span></div>`;
  pricingHtml += `<div class="recipe-cost-readout"><span class="field-label">Gross Profit</span><span class="recipe-cost-gross-profit recipe-cost-readout-value">${fmtMoney(data.grossProfit)}</span></div>`;
  pricingHtml += `<div class="recipe-cost-readout"><span class="field-label">Gross Margin</span><span class="recipe-cost-gross-margin recipe-cost-readout-value">${fmtPercent(data.grossMargin)}</span></div>`;
  pricingHtml += '</div></div>';

  const saveHtml = editAllowed
    ? '<div class="recipe-card-actions"><button type="button" class="btn btn-gold btn-small recipe-cost-save-btn">Save Costing</button></div>'
    : '';

  paneEl.innerHTML = ingHtml + otherHtml + totalHtml + pricingHtml + saveHtml;
  paneEl.dataset.ingredientCost = String(data.ingredientCost || 0);
  paneEl.dataset.rendered = '1';

  wireRecipeCostPaneEvents(paneEl, recipeId);
}

// Builds one labeled field: an editable .field-input with a currency/
// percent affix when the user can edit it, or a plain read-only value
// otherwise (matching .field-input:disabled's muted, non-interactive
// look without being an actual disabled input).
function costFieldHtml(label, key, value, editable, affix, affixSide, decimals) {
  const displayVal = (value === null || value === undefined || value === '') ? '' : value;
  if (!editable) {
    const shown = displayVal === '' ? '—' : Number(displayVal).toFixed(decimals);
    const text = displayVal === '' ? '—' : (affixSide === 'prefix' ? affix + shown : shown + affix);
    return `<div class="recipe-cost-field"><span class="field-label">${escapeHtml(label)}</span><span class="recipe-cost-readout-value">${text}</span></div>`;
  }
  const affixHtml = `<span class="field-affix">${affix}</span>`;
  const inputHtml = `<input type="number" min="0" step="0.01" class="field-input recipe-cost-input" data-key="${key}" value="${displayVal}">`;
  const inner = affixSide === 'prefix' ? affixHtml + inputHtml : inputHtml + affixHtml;
  return `<div class="recipe-cost-field"><label class="field-label">${escapeHtml(label)}</label><div class="field-input-group has-${affixSide}">${inner}</div></div>`;
}

function wireRecipeCostPaneEvents(paneEl, recipeId) {
  const ingredientCost = parseFloat(paneEl.dataset.ingredientCost) || 0;

  function fieldVal(key) {
    const el = paneEl.querySelector(`.recipe-cost-input[data-key="${key}"]`);
    if (!el) return null;
    const v = parseFloat(el.value);
    return isNaN(v) ? null : v;
  }
  function setFieldVal(key, v) {
    const el = paneEl.querySelector(`.recipe-cost-input[data-key="${key}"]`);
    if (el) el.value = v;
  }

  function currentTotalCost() {
    const wastage = fieldVal('wastage') || 0;
    const garnish = fieldVal('garnish') || 0;
    const other = fieldVal('other') || 0;
    const otherTotal = wastage + garnish + other;
    return ingredientCost + otherTotal;
  }

  // Recompute Other Costs total + Total Cost display, and (per the
  // locked pricing rule) Gross Profit/Margin/Customer Price from
  // whatever Selling Price is currently in the field — Selling Price
  // and Target Margin are never touched by a cost change.
  function recalcFromCosts() {
    const wastage = fieldVal('wastage') || 0;
    const garnish = fieldVal('garnish') || 0;
    const other = fieldVal('other') || 0;
    const otherTotal = wastage + garnish + other;
    const totalCost = ingredientCost + otherTotal;
    const otherTotalEl = paneEl.querySelector('.recipe-cost-other-total');
    if (otherTotalEl) otherTotalEl.textContent = fmtMoney(otherTotal);
    const totalEl = paneEl.querySelector('.recipe-cost-total-value');
    if (totalEl) totalEl.textContent = fmtMoney(totalCost);
    recalcDerivedFromSellingPrice(totalCost);
  }

  // Gross Profit/Margin/Customer Price from the Selling Price field as-is.
  function recalcDerivedFromSellingPrice(totalCost) {
    const sellingPrice = fieldVal('sellingPrice');
    const vatPercent = fieldVal('vatPercent') || 0;
    const gpEl = paneEl.querySelector('.recipe-cost-gross-profit');
    const gmEl = paneEl.querySelector('.recipe-cost-gross-margin');
    const cpEl = paneEl.querySelector('.recipe-cost-customer-price');
    if (sellingPrice === null) {
      if (gpEl) gpEl.textContent = '—';
      if (gmEl) gmEl.textContent = '—';
      if (cpEl) cpEl.textContent = '—';
      return;
    }
    const grossProfit = sellingPrice - totalCost;
    const grossMargin = sellingPrice > 0 ? grossProfit / sellingPrice : null;
    const customerPrice = sellingPrice * (1 + vatPercent / 100);
    if (gpEl) gpEl.textContent = fmtMoney(grossProfit);
    if (gmEl) gmEl.textContent = fmtPercent(grossMargin);
    if (cpEl) cpEl.textContent = fmtMoney(customerPrice);
  }

  paneEl.querySelectorAll('.recipe-cost-input[data-key="wastage"], .recipe-cost-input[data-key="garnish"], .recipe-cost-input[data-key="other"]').forEach(el => {
    el.addEventListener('input', recalcFromCosts);
  });

  const sellingPriceEl = paneEl.querySelector('.recipe-cost-input[data-key="sellingPrice"]');
  if (sellingPriceEl) {
    // Direct Selling Price edit: recompute Gross Profit/Margin/Customer
    // Price only. Target Margin is never changed/cleared/recalculated.
    sellingPriceEl.addEventListener('input', () => recalcDerivedFromSellingPrice(currentTotalCost()));
  }

  const vatEl = paneEl.querySelector('.recipe-cost-input[data-key="vatPercent"]');
  if (vatEl) {
    vatEl.addEventListener('input', () => recalcDerivedFromSellingPrice(currentTotalCost()));
  }

  const targetMarginEl = paneEl.querySelector('.recipe-cost-input[data-key="targetMargin"]');
  if (targetMarginEl) {
    // Explicit Target Margin edit: compute Selling Price = Total Cost /
    // (1 - Target Margin) and write it in via a plain .value assignment
    // (does not fire 'input', so it cannot re-trigger the Selling Price
    // handler above — this is what keeps the two fields from looping).
    // Then recompute Gross Profit/Margin/Customer Price from that.
    targetMarginEl.addEventListener('input', () => {
      const pct = fieldVal('targetMargin');
      const totalCost = currentTotalCost();
      if (pct === null || pct < 0 || pct >= 100) {
        // Invalid/undefined margin — leave Selling Price untouched, just
        // clear the derived outputs to avoid showing a stale/wrong value.
        recalcDerivedFromSellingPrice(totalCost);
        return;
      }
      const sellingPrice = totalCost / (1 - pct / 100);
      setFieldVal('sellingPrice', sellingPrice.toFixed(2));
      recalcDerivedFromSellingPrice(totalCost);
    });
  }

  const setCostBtns = paneEl.querySelectorAll('.ing-set-cost-btn');
  setCostBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.recipe-cost-set-cost');
      const input = row.querySelector('.ing-set-cost-input');
      const val = parseFloat(input.value);
      if (isNaN(val) || val < 0) { toast('Enter a valid, non-negative cost.', true); return; }
      const itemId = btn.dataset.itemId;
      const item = findItemById(itemId);
      if (!item) { toast('Item not found.', true); return; }
      btn.disabled = true;
      try {
        // Send the item's full current field set alongside purchaseCost -
        // updateItem clears volume/salesVolume when they are omitted, so
        // a partial {itemId, purchaseCost} call would silently wipe them.
        await api.updateItem(itemId, {
          name: item.name,
          categoryId: item.categoryId,
          unit: item.unit,
          volume: item.volume,
          volumeUnit: item.volumeUnit,
          salesVolume: item.salesVolume,
          salesVolumeUnit: item.salesVolumeUnit,
          servingName: item.servingName,
          purchaseCost: val
        });
        toast('Item cost saved.');
        await refreshRecipeCostPane(recipeId, paneEl);
      } catch (e) {
        toast(e.message || 'Failed to save item cost.', true);
      } finally {
        btn.disabled = false;
      }
    });
  });

  // Custom/unlinked ingredients: cost is entered directly on the recipe
  // ingredient line (no items row exists to attach it to).
  const setManualCostBtns = paneEl.querySelectorAll('.ing-set-manual-cost-btn');
  setManualCostBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.recipe-cost-set-cost');
      const input = row.querySelector('.ing-set-manual-cost-input');
      const val = parseFloat(input.value);
      if (isNaN(val) || val < 0) { toast('Enter a valid, non-negative cost.', true); return; }
      const ingredientId = btn.dataset.ingredientId;
      btn.disabled = true;
      try {
        await api.setIngredientCost(recipeId, ingredientId, val);
        toast('Cost saved.');
        await refreshRecipeCostPane(recipeId, paneEl);
      } catch (e) {
        toast(e.message || 'Failed to save cost.', true);
      } finally {
        btn.disabled = false;
      }
    });
  });

  const saveBtn = paneEl.querySelector('.recipe-cost-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const targetMarginPct = fieldVal('targetMargin');
      const payload = {
        wastageCost: fieldVal('wastage') || 0,
        garnishCost: fieldVal('garnish') || 0,
        otherCost: fieldVal('other') || 0,
        targetMargin: targetMarginPct === null ? null : targetMarginPct / 100,
        sellingPrice: fieldVal('sellingPrice'),
        vatPercent: fieldVal('vatPercent') || 0
      };
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const data = await api.saveRecipeCosting(recipeId, payload);
        recipeState.costs[recipeId] = data;
        renderRecipeCostPane(paneEl, recipeId, data);
        toast('Costing saved.');
      } catch (e) {
        toast(e.message || 'Failed to save costing.', true);
      } finally {
        if (saveBtn.isConnected) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Costing';
        }
      }
    });
  }
}

// Finds an item's current full record (as loaded via loadStock) across
// all categories, used to build a non-destructive updateItem payload
// when saving purchase cost from the Cost tab.
function findItemById(itemId) {
  for (const cat of state.categories) {
    const it = cat.items.find(i => i.id === itemId);
    if (it) return { ...it, categoryId: cat.id };
  }
  return null;
}

const rsInput = document.getElementById('recipeSearchInput');
rsInput.addEventListener('input', applyRecipeSearch);

function applyRecipeSearch() {
  const q = rsInput.value.trim().toLowerCase();
  const root = document.getElementById('recipesRoot');
  let any = false;
  root.querySelectorAll('.cat-card').forEach(card => {
    const nm = card.dataset.recipeName || '';
    const m = !q || nm.includes(q);
    card.classList.toggle('is-empty-search', !m);
    if (m) any = true;
  });
  document.getElementById('recipeEmptyState').classList.toggle('show', q && !any);
}

function delRecipe(r) {
  openConfirm('Delete Recipe', 'Delete "<b>' + escapeHtml(r.name) + '</b>"?<br>This will only remove the recipe.<br>Your inventory stock will not be affected.', async () => {
    try {
      await api.deleteRecipe(r.id);
      recipeState.recipes = recipeState.recipes.filter(x => x.id !== r.id);
      delete recipeState.costs[r.id];
      renderRecipes();
      toast('Recipe deleted.');
    } catch (e) {
      toast(e.message || 'Failed to delete recipe.', true);
    }
  }, 'Delete');
}

const rmo = document.getElementById('recipeModalOverlay');
const rmt = document.getElementById('recipeModalTitle');
const rn = document.getElementById('recipeName');
const rg = document.getElementById('recipeGlass');
const rm = document.getElementById('recipeMethod');
const rgr = document.getElementById('recipeGarnish');
const ril = document.getElementById('recipeIngredientsList');
const rmf = document.getElementById('recipeModalConfirm');

function buildIngRow(ing = null) {
  const row = document.createElement('div');
  row.className = 'ingredient-editor-row';
  row.style.flexWrap = 'wrap';
  row.style.alignItems = 'flex-start';

  const modeWrap = document.createElement('div');
  modeWrap.style.display = 'flex';
  modeWrap.style.gap = '4px';
  modeWrap.style.flex = '1 1 100%';
  const invBtn = document.createElement('button');
  invBtn.type = 'button';
  invBtn.className = 'ing-mode-btn btn btn-gold btn-small active';
  invBtn.textContent = 'Inventory';
  invBtn.style.flex = '1';
  invBtn.style.fontSize = '0.7rem';
  invBtn.style.minHeight = '30px';
  const recBtn = document.createElement('button');
  recBtn.type = 'button';
  recBtn.className = 'ing-mode-btn btn btn-ghost btn-small';
  recBtn.textContent = 'Recipe Ingredient';
  recBtn.style.flex = '1';
  recBtn.style.fontSize = '0.7rem';
  recBtn.style.minHeight = '30px';
  modeWrap.appendChild(invBtn);
  modeWrap.appendChild(recBtn);

  const catSel = document.createElement('select');
  catSel.className = 'ing-cat-select';
  catSel.style.minWidth = '120px';
  catSel.style.flex = '1';
  catSel.innerHTML = '<option value="">-- Category --</option>';
  state.categories.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    catSel.appendChild(o);
  });

  const itemSel = document.createElement('select');
  itemSel.className = 'ing-item-select';
  itemSel.style.minWidth = '120px';
  itemSel.style.flex = '2';
  itemSel.innerHTML = '<option value="">-- Select item --</option>';

  function populateItemSel(catId, selectedItemId = null) {
    itemSel.innerHTML = '<option value="">-- Select item --</option>';
    if (!catId) return;
    const cat = state.categories.find(c => c.id === catId);
    if (!cat) return;
    cat.items.forEach(it => {
      const o = document.createElement('option');
      o.value = it.id;
      o.textContent = it.name;
      if (selectedItemId && it.id === selectedItemId) o.selected = true;
      itemSel.appendChild(o);
    });
  }
  catSel.addEventListener('change', () => populateItemSel(catSel.value));

  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.className = 'ing-custom-name';
  customInput.placeholder = 'Ingredient name';
  customInput.style.flex = '2';
  customInput.style.display = 'none';

  const ai = document.createElement('input');
  ai.type = 'number';
  ai.min = '0';
  ai.placeholder = 'Amt';
  ai.className = 'ing-amount';
  ai.style.width = '65px';
  ai.style.flex = 'none';
  const us = document.createElement('select');
  us.className = 'unit-select';
  us.style.width = '80px';
  us.style.flex = 'none';
  appConfig.units.forEach(u => {
    const o = document.createElement('option');
    o.value = u.value;
    o.textContent = u.label;
    us.appendChild(o);
  });

  const db = document.createElement('button');
  db.className = 'ingredient-delete-btn';
  db.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  db.addEventListener('click', () => row.remove());

  const convertBtn = document.createElement('button');
  convertBtn.type = 'button';
  convertBtn.className = 'btn btn-ghost btn-small';
  convertBtn.textContent = 'Convert to Inventory';
  convertBtn.style.display = 'none';
  convertBtn.style.fontSize = '0.7rem';
  convertBtn.addEventListener('click', () => {
    recBtn.classList.remove('active'); recBtn.classList.add('btn-ghost'); recBtn.classList.remove('btn-gold');
    invBtn.classList.add('active'); invBtn.classList.add('btn-gold'); invBtn.classList.remove('btn-ghost');
    catSel.style.display = 'inline-block';
    itemSel.style.display = 'inline-block';
    customInput.style.display = 'none';
    convertBtn.style.display = 'none';
  });

  invBtn.addEventListener('click', () => {
    invBtn.classList.add('active'); invBtn.classList.add('btn-gold'); invBtn.classList.remove('btn-ghost');
    recBtn.classList.remove('active'); recBtn.classList.remove('btn-gold'); recBtn.classList.add('btn-ghost');
    catSel.style.display = 'inline-block';
    itemSel.style.display = 'inline-block';
    customInput.style.display = 'none';
    convertBtn.style.display = 'none';
  });
  recBtn.addEventListener('click', () => {
    recBtn.classList.add('active'); recBtn.classList.add('btn-gold'); recBtn.classList.remove('btn-ghost');
    invBtn.classList.remove('active'); invBtn.classList.remove('btn-gold'); invBtn.classList.add('btn-ghost');
    catSel.style.display = 'none';
    itemSel.style.display = 'none';
    customInput.style.display = 'inline-block';
    convertBtn.style.display = 'none';
    catSel.value = '';
    itemSel.innerHTML = '<option value="">-- Select item --</option>';
  });

  if (ing) {
    const hasInventory = ing.inventoryItemId && !ing.customName;
    if (hasInventory) {
      invBtn.click();
      const cat = state.categories.find(c => c.items.some(it => it.id === ing.inventoryItemId));
      if (cat) {
        catSel.value = cat.id;
        populateItemSel(cat.id, ing.inventoryItemId);
      }
    } else {
      recBtn.click();
      customInput.value = ing.customName || '';
      convertBtn.style.display = 'inline-block';
    }
    ai.value = ing.amount || '';
    us.value = ing.unit || 'ml';
  } else {
    invBtn.click();
  }

  row.appendChild(modeWrap);
  row.appendChild(catSel);
  row.appendChild(itemSel);
  row.appendChild(customInput);
  row.appendChild(ai);
  row.appendChild(us);
  row.appendChild(db);
  row.appendChild(convertBtn);
  return row;
}

function resetIngList(ings = []) {
  ril.innerHTML = '';
  if (ings.length === 0) ril.appendChild(buildIngRow());
  else ings.forEach(ing => ril.appendChild(buildIngRow(ing)));
}

document.getElementById('addIngredientBtn').addEventListener('click', () => ril.appendChild(buildIngRow()));

function openRecipeModal(recipe = null) {
  editingRecipeId = recipe ? recipe.id : null;
  rmt.textContent = recipe ? 'Edit Recipe' : 'Add Recipe';
  rn.value = recipe ? recipe.name || '' : '';
  rg.value = recipe ? recipe.glass || '' : '';
  rm.value = recipe ? recipe.method || '' : '';
  rgr.value = recipe ? recipe.garnish || '' : '';
  resetIngList(recipe ? recipe.ingredients || [] : []);
  openModal(rmo);
  setTimeout(() => rn.focus(), 250);
}

document.getElementById('recipeModalCancel').addEventListener('click', () => {
  closeModal(rmo);
  editingRecipeId = null;
});

rmf.addEventListener('click', async () => {
  const name = rn.value.trim();
  if (!name) { rn.focus(); return; }
  const ings = [];
  ril.querySelectorAll('.ingredient-editor-row').forEach(row => {
    const modeBtns = row.querySelectorAll('.ing-mode-btn');
    const isInventory = modeBtns.length > 0 && modeBtns[0].classList.contains('active');
    const catSel = row.querySelector('.ing-cat-select');
    const itemSel = row.querySelector('.ing-item-select');
    const customInput = row.querySelector('input.ing-custom-name');
    const ai = row.querySelector('input.ing-amount');
    const us = row.querySelector('.unit-select');
    const amount = parseFloat(ai?.value) || 0;
    const unit = us?.value || 'ml';
    if (isInventory) {
      const iid = itemSel?.value || null;
      if (iid) ings.push({ inventoryItemId: iid, amount, unit });
    } else {
      const cn = customInput?.value?.trim() || null;
      if (cn) ings.push({ customName: cn, amount, unit });
    }
  });
  if (ings.length === 0) { toast('Add at least one ingredient.', true); return; }
  const payload = { name, glass: rg.value.trim(), method: rm.value.trim(), garnish: rgr.value.trim(), ingredients: ings };
  rmf.disabled = true;
  rmf.textContent = 'Saving…';
  try {
    if (editingRecipeId) {
      await api.updateRecipe(editingRecipeId, payload);
      toast('Recipe updated.');
    } else {
      await api.createRecipe(payload);
      toast('Recipe created.');
    }
    closeModal(rmo);
    editingRecipeId = null;
    await loadRecipes();
  } catch (e) {
    toast(e.message || 'Failed to save recipe.', true);
  } finally {
    rmf.disabled = false;
    rmf.textContent = 'Save Recipe';
  }
});

window.loadRecipes = loadRecipes;
window.loadRecipeCostsFor = loadRecipeCostsFor;
window.renderRecipes = renderRecipes;
window.renderRecipeCard = renderRecipeCard;
window.applyRecipeSearch = applyRecipeSearch;
window.delRecipe = delRecipe;
window.buildIngRow = buildIngRow;
window.resetIngList = resetIngList;
window.openRecipeModal = openRecipeModal;