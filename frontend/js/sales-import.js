'use strict';

function showSalesDetail() {
  const content = document.getElementById('salesContainer');
  if (!content) return;
  content.innerHTML = `
    <div class="purchase-register-toolbar">
      <div>
        <div class="purchase-register-title">Sales</div>
        <div class="purchase-register-subtitle">Import POS reports and track sales</div>
      </div>
    </div>

    <div id="salesUploadSection" class="sales-summary-card" style="margin-top:0;">
      <div class="sales-summary-header">
        <div class="sales-summary-title">Upload Sales CSV</div>
        <div class="sales-summary-desc">Import a new Flatpay CSV or XLSX sales report.</div>
      </div>
      <label class="file-upload-wrap" for="salesCsvFile">
        <span class="file-upload-btn">Choose CSV or XLSX File</span>
        <span class="file-upload-filename" id="salesCsvFileName">No file selected</span>
      </label>
      <input type="file" id="salesCsvFile" accept=".csv,.xlsx" class="file-upload-input">
      <div id="salesImportPreview"></div>
    </div>

    <div class="sales-summary-card">
      <div class="sales-summary-header">
        <div class="sales-summary-title">Sales Summary</div>
        <div class="sales-summary-desc">Track sales, recipes, inventory deductions, and imported sales reports.</div>
      </div>
      <div class="segmented-control" id="salesPeriodControl">
        <button class="segmented-btn active" data-period="today">Today</button>
        <button class="segmented-btn" data-period="7days">Last 7 days</button>
        <button class="segmented-btn" data-period="30days">Last 30 days</button>
        <button class="segmented-btn" data-period="month">This Month</button>
      </div>
    </div>

    <div id="salesOverviewSection" class="sales-summary-card">
      <div class="sales-summary-header">
        <div class="sales-summary-title">Sales Overview</div>
      </div>
      <div id="salesOverviewContent"></div>
    </div>

    <div id="salesRecordsSection" class="sales-summary-card">
      <div class="sales-summary-header">
        <div class="sales-summary-title">Sales Records</div>
        <div class="sales-summary-desc">Products sold during the selected period.</div>
      </div>
      <div id="salesRecordsContent"></div>
    </div>

    <div id="salesImportBatchesSection" class="sales-summary-card">
      <div class="sales-summary-header">
        <div class="sales-summary-title">Import Batches</div>
        <div class="sales-summary-desc">Sales reports imported during the selected period.</div>
      </div>
      <div id="salesImportBatchesContent"></div>
    </div>
  `;

  document.getElementById('salesCsvFile').addEventListener('change', handleSalesFileSelect);

  document.querySelectorAll('#salesPeriodControl .segmented-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#salesPeriodControl .segmented-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadSalesSummary(btn.dataset.period);
    });
  });

  loadSalesSummary('today');
  loadSalesImportHistory();
  refreshServingNameSuggestionsFromServer();
}

async function handleSalesFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  const nameEl = document.getElementById('salesCsvFileName');
  if (nameEl) nameEl.textContent = file.name;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const data = await apiUpload('/pos/sales/import/preview', formData);
    salesFileHash = data.fileHash;
    salesPeriodStart = data.periodStart;
    salesPeriodEnd = data.periodEnd;
    salesItems = data.items;
    renderSalesPreview();
  } catch (err) {
    toast(err.message || 'Failed to preview CSV', true);
  }
}

function buildMappingOptionsHtml(item) {
  let html = '<option value="">-- Select --</option>';

  // Inventory items grouped by category
  state.categories.forEach(cat => {
    const group = document.createElement('optgroup');
    group.label = cat.name || 'Uncategorised';
    cat.items.forEach(it => {
      const selected = item.matched && item.type === 'inventory' && item.itemId === it.id ? ' selected' : '';
      group.innerHTML += `<option value="${it.id}" data-mapping-type="inventory"${selected}>${escapeHtml(it.name)}</option>`;
    });
    if (group.children.length) {
      html += group.outerHTML;
    }
  });

  // Recipe group
  const recipes = (recipeState && Array.isArray(recipeState.recipes)) ? recipeState.recipes : [];
  if (recipes.length) {
    const recipeGroup = document.createElement('optgroup');
    recipeGroup.label = 'Recipes';
    recipes.forEach(r => {
      const selected = item.matched && item.type === 'recipe' && item.recipeId === r.id ? ' selected' : '';
      recipeGroup.innerHTML += `<option value="${r.id}" data-mapping-type="recipe"${selected}>${escapeHtml(r.name || 'Unnamed Recipe')}</option>`;
    });
    html += recipeGroup.outerHTML;
  }

  return html;
}

function buildUnitOptionsHtml(selectedUnit) {
  let html = '<option value="">-- Select unit --</option>';
  (appConfig.units || []).forEach(u => {
    const selected = u.value === selectedUnit ? ' selected' : '';
    html += `<option value="${escapeHtml(u.value)}"${selected}>${escapeHtml(u.label)}</option>`;
  });
  return html;
}

// Same restriction as the item-config "Sales volume unit" field
// (inventory-config.js popSalesVolumeUnitSel) - the conversion engine
// (amountToMl) only understands ml/cl/L, so the serving-volume unit
// dropdown offers only those, never the full stock-unit list.
function buildServingVolumeUnitOptionsHtml(selectedUnit) {
  let html = '<option value="">--</option>';
  (appConfig.units || []).filter(u => ['ml', 'cl', 'L'].includes(u.value)).forEach(u => {
    const selected = u.value === selectedUnit ? ' selected' : '';
    html += `<option value="${escapeHtml(u.value)}"${selected}>${escapeHtml(u.label)}</option>`;
  });
  return html;
}

/**
 * Merge server-known serving names (item defaults + saved mapping
 * overrides) into the shared "Serving name" datalist. Additive to
 * whatever inventory-config.js already populated from loaded items;
 * free typing is always allowed regardless of what's in the list.
 */
async function refreshServingNameSuggestionsFromServer() {
  const list = document.getElementById('servingNameSuggestions');
  if (!list) return;
  try {
    const data = await api.getSalesServingNames();
    const names = (data && Array.isArray(data.names)) ? data.names : [];
    const existing = new Set(Array.from(list.options).map(o => o.value));
    names.forEach(n => {
      if (n && !existing.has(n)) {
        existing.add(n);
        list.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(n)}"></option>`);
      }
    });
  } catch (err) {
    // Suggestions are a convenience only - failing to fetch them never
    // blocks typing a serving name manually.
  }
}

function getSalesPreviewBadge(item) {
  if (item.type === 'inventory' && item.matched) {
    return '<span class="badge-active">📦 Inventory · ✓ Found</span>';
  }
  if (item.type === 'recipe' && item.matched) {
    return '<span class="badge-active">🥃 Recipe · ✓ Found</span>';
  }
  if (item.type === 'unresolved') {
    return '<span class="badge-inactive">⚠ Unresolved · Needs mapping</span>';
  }
  if (item.type === 'ambiguous') {
    return '<span class="badge-inactive">⚠ Ambiguous · Needs review</span>';
  }
  return item.matched
    ? '<span class="badge-active">✓ Matched</span>'
    : '<span class="badge-inactive">Needs mapping</span>';
}

function renderSalesPreview() {
  const previewDiv = document.getElementById('salesImportPreview');
  if (!previewDiv) return;
  if (!salesItems.length) {
    previewDiv.innerHTML = '<p style="font-size:0.82rem;color:var(--paper-faint);">No items to preview.</p>';
    return;
  }

  let html = `<table class="staff-table" style="margin-top:var(--space-2);">
    <thead><tr><th>POS Product</th><th>Resolved To</th><th>Qty Sold</th><th>Serving</th><th>Pour unit</th><th>Status</th></tr></thead><tbody>`;

  salesItems.forEach((item, idx) => {
    const badge = getSalesPreviewBadge(item);
    let resolvedTo = '';

    if (item.matched && item.type === 'inventory') {
      resolvedTo = escapeHtml(item.itemName || '—');
    } else if (item.matched && item.type === 'recipe') {
      resolvedTo = escapeHtml(item.recipeName || '—');
    } else {
      resolvedTo = '<span class="badge-inactive">Unmatched</span>';
    }

    const mappingSelect = `<select class="field-select sales-map-select" id="mapSelect_${idx}" style="width:auto;min-width:160px;display:inline-block;padding:8px 10px;font-size:0.82rem;">${buildMappingOptionsHtml(item)}</select>`;

    // Existing Flatpay/wine variable-pour raw-unit override. Only ever
    // populated from a real CSV "Unit" column or a saved per-product
    // mapping unit - never auto-filled from the item's stock unit, which
    // is what previously made a configured serving unreachable (the
    // "4 glass -> 4 kegs" bug).
    const pourUnit = item.unit || '';

    const pourUnitControl = item.type === 'inventory'
      ? `<select class="field-select sales-unit-select" id="unitSelect_${idx}" style="width:auto;min-width:90px;display:inline-block;padding:8px 10px;font-size:0.82rem;">${buildUnitOptionsHtml(pourUnit)}</select>`
      : '—';

    let servingControl = '—';

    if (item.type === 'inventory') {
      // Prefilled by the backend preview: saved mapping override, else the
      // item's own configured default, else blank (unconfigured item -
      // falls back to the item's stock unit at import time untouched).
      const servingName = item.servingName || '';
      const salesVolume = item.salesVolume != null ? item.salesVolume : '';
      const salesVolumeUnit = item.salesVolumeUnit || '';

      servingControl = `
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
          <input type="text" class="field-input sales-serving-name" id="servingName_${idx}"
                 list="servingNameSuggestions" autocomplete="off" placeholder="e.g. Glass"
                 value="${escapeHtml(servingName)}"
                 style="width:110px;display:inline-block;padding:8px 10px;font-size:0.82rem;">
          <input type="number" class="field-input sales-serving-volume" id="servingVolume_${idx}"
                 min="0" step="0.01" placeholder="Vol" value="${salesVolume === '' ? '' : escapeHtml(String(salesVolume))}"
                 style="width:64px;display:inline-block;padding:8px 8px;font-size:0.82rem;">
          <select class="field-select sales-serving-unit" id="servingUnit_${idx}"
                  style="width:auto;min-width:64px;display:inline-block;padding:8px 8px;font-size:0.82rem;">${buildServingVolumeUnitOptionsHtml(salesVolumeUnit)}</select>
          <button type="button" class="btn btn-ghost btn-small sales-save-default-btn" id="saveDefault_${idx}"
                  style="font-size:0.72rem;padding:6px 8px;white-space:nowrap;" ${item.itemId ? '' : 'disabled'}
                  title="Save this serving as the default for this POS product">Save as default</button>
        </div>`;
    }

    html += `<tr>
      <td>${escapeHtml(item.sourceProductName)}</td>
      <td>${mappingSelect}</td>
      <td>${item.quantitySold}</td>
      <td>${servingControl}</td>
      <td>${pourUnitControl}</td>
      <td>${badge}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  html += `<button id="applySalesBtn" class="btn btn-gold btn-small" style="margin-top:var(--space-2);" ${salesItems.some(it => !it.matched) ? 'disabled' : ''}>Apply Sales</button>`;
  previewDiv.innerHTML = html;

  salesItems.forEach((item, idx) => {
    const mapSelect = document.getElementById(`mapSelect_${idx}`);
    if (mapSelect) {
      mapSelect.addEventListener('change', async (e) => {
        const selectedOption = e.target.selectedOptions[0];
        const value = e.target.value;
        const mappingType = selectedOption ? selectedOption.dataset.mappingType : null;
        if (!value || !mappingType) {
          // If cleared, set unmatched but keep type from backend?
          item.matched = false;
          renderSalesPreview();
          return;
        }

        try {
          if (mappingType === 'recipe') {
            await api.saveSalesMapping(item.sourceProductName, null, value);
            item.itemId = null;
            item.itemName = null;
            item.recipeId = value;
            item.recipeName = selectedOption.textContent;
            item.type = 'recipe';
            item.servingName = null;
            item.salesVolume = null;
            item.salesVolumeUnit = null;
          } else {
            await api.saveSalesMapping(item.sourceProductName, value, null);
            item.itemId = value;
            item.itemName = selectedOption.textContent;
            item.recipeId = null;
            item.recipeName = null;
            item.type = 'inventory';

            // Newly picked item wasn't part of the original preview
            // response - pull its own configured serving default (if any)
            // from already-loaded inventory data, same as the backend
            // would for a fresh preview.
            const resolvedItem = findItem(value);
            item.servingName = (resolvedItem && resolvedItem.item.servingName) || null;
            item.salesVolume = (resolvedItem && resolvedItem.item.salesVolume != null) ? resolvedItem.item.salesVolume : null;
            item.salesVolumeUnit = (resolvedItem && resolvedItem.item.salesVolumeUnit) || null;
          }

          item.matched = true;
          renderSalesPreview();
          toast('Mapping saved.');
        } catch (err) {
          toast(err.message || 'Failed to save mapping', true);
        }
      });
    }

    const unitSelect = document.getElementById(`unitSelect_${idx}`);
    if (unitSelect) {
      unitSelect.addEventListener('change', (e) => {
        item.unit = e.target.value || null;
      });
    }

    const servingNameInput = document.getElementById(`servingName_${idx}`);
    if (servingNameInput) {
      servingNameInput.addEventListener('input', (e) => {
        item.servingName = e.target.value.trim() || null;
      });
    }

    const servingVolumeInput = document.getElementById(`servingVolume_${idx}`);
    if (servingVolumeInput) {
      servingVolumeInput.addEventListener('input', (e) => {
        const v = e.target.value;
        item.salesVolume = v === '' ? null : v;
      });
    }

    const servingUnitSelect = document.getElementById(`servingUnit_${idx}`);
    if (servingUnitSelect) {
      servingUnitSelect.addEventListener('change', (e) => {
        item.salesVolumeUnit = e.target.value || null;
      });
    }

    const saveDefaultBtn = document.getElementById(`saveDefault_${idx}`);
    if (saveDefaultBtn) {
      saveDefaultBtn.addEventListener('click', async () => {
        if (!item.itemId) return;
        saveDefaultBtn.disabled = true;
        const originalLabel = saveDefaultBtn.textContent;
        saveDefaultBtn.textContent = 'Saving…';

        try {
          await api.saveSalesMapping(item.sourceProductName, item.itemId, null, {
            unit: item.unit || null,
            servingName: item.servingName || null,
            salesVolume: item.salesVolume,
            salesVolumeUnit: item.salesVolumeUnit
          });
          toast(`Saved "${item.servingName || item.salesVolumeUnit || 'serving'}" as the default for "${item.sourceProductName}".`);
          refreshServingNameSuggestionsFromServer();
        } catch (err) {
          toast(err.message || 'Failed to save default serving', true);
        } finally {
          saveDefaultBtn.disabled = false;
          saveDefaultBtn.textContent = originalLabel;
        }
      });
    }
  });

  const applyBtn = document.getElementById('applySalesBtn');
  if (applyBtn) {
    applyBtn.addEventListener('click', async () => {
      const allMatched = salesItems.every(it => it.matched);
      if (!allMatched) return;

      applyBtn.disabled = true;
      applyBtn.textContent = 'Applying…';

      try {
        await api.applySalesImport(
          salesFileHash,
          salesPeriodStart,
          salesPeriodEnd,
          salesItems.map(it => ({
            itemId: it.itemId || undefined,
            recipeId: it.recipeId || undefined,
            sourceProductName: it.sourceProductName,
            quantitySold: it.quantitySold,
            // Existing Flatpay/wine variable-pour raw-unit override.
            unit: it.type === 'inventory' ? (it.unit || null) : null,
            // Serving definition currently shown for this sale - the
            // item's/mapping's default unless the user edited it for this
            // one sale. servingName is a label only; salesVolume/
            // salesVolumeUnit are what the backend actually converts.
            servingName: it.type === 'inventory' ? (it.servingName || null) : null,
            salesVolume: it.type === 'inventory' ? (it.salesVolume != null && it.salesVolume !== '' ? it.salesVolume : null) : null,
            salesVolumeUnit: it.type === 'inventory' ? (it.salesVolumeUnit || null) : null
          }))
        );

        toast('Sales imported successfully. Inventory has been updated.');

        salesFileHash = null;
        salesPeriodStart = null;
        salesPeriodEnd = null;
        salesItems = [];
        document.getElementById('salesCsvFile').value = '';
        renderSalesPreview();
        loadInventory();
        loadSalesSummary('today');
      } catch (err) {
        if (err.code === 'SALES_IMPORT_ALREADY_EXISTS') {
          toast('This sales report has already been imported.', true);
        } else {
          toast(err.message || 'Failed to apply sales', true);
        }
      } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply Sales';
      }
    });
  }
}
async function loadSalesSummary(period) {
  const overviewDiv = document.getElementById('salesOverviewContent');
  const recordsDiv = document.getElementById('salesRecordsContent');
  if (!overviewDiv || !recordsDiv) return;

  const cacheKey = CACHE_KEYS.salesSummary + ':' + period;
  const cached = getSessionCache(cacheKey);
  if (cached) {
    renderSalesOverview(cached);
    renderSalesRecords(cached);
    return;
  }

  overviewDiv.innerHTML = '<div class="loading-spinner" style="margin:1rem auto;"></div>';
  recordsDiv.innerHTML = '';

  try {
    const data = await api.getSalesSummary(period);
    const summary = (data && data.summary && Array.isArray(data.summary)) ? data.summary : [];

    setSessionCache(cacheKey, summary);
    renderSalesOverview(summary);
    renderSalesRecords(summary);
  } catch (err) {
    overviewDiv.innerHTML = '<div class="sales-state-box">Failed to load sales data.</div>';
    recordsDiv.innerHTML = '';
  }
}

function renderSalesOverview(summary) {
  const overviewDiv = document.getElementById('salesOverviewContent');
  if (!overviewDiv) return;

  const totalUnits = summary.reduce((sum, s) => sum + (parseFloat(s.quantity) || 0), 0);
  const totalProducts = summary.length;

  overviewDiv.innerHTML = `
    <div class="sales-overview-grid">
      <div class="sales-overview-card">
        <div class="sales-overview-num">${totalProducts}</div>
        <div class="sales-overview-label">Products Sold</div>
      </div>
      <div class="sales-overview-card">
        <div class="sales-overview-num">${totalUnits}</div>
        <div class="sales-overview-label">Units Sold</div>
      </div>
    </div>
  `;
}

function renderSalesRecords(summary) {
  const recordsDiv = document.getElementById('salesRecordsContent');
  if (!recordsDiv) return;

  if (!summary.length) {
    recordsDiv.innerHTML = '<div class="sales-state-box">No sales recorded for this period.</div>';
    return;
  }

  let html = `<table class="sales-records-table">
    <thead><tr><th>Date</th><th>Product</th><th>Quantity</th><th>Unit</th></tr></thead><tbody>`;

  summary.forEach(s => {
    const productName = s.product || s.itemName || 'Unknown';
    const quantity = s.quantity ?? s.totalSold ?? 0;
    const unit = s.unit || '—';
    const saleDate = s.date
      ? new Date(s.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      : '—';

    html += `<tr>
      <td>${escapeHtml(saleDate)}</td>
      <td>${escapeHtml(productName)}</td>
      <td>${quantity}</td>
      <td>${escapeHtml(unit)}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  recordsDiv.innerHTML = html;
}

async function loadSalesImportHistory() {
  const container = document.getElementById('salesImportBatchesContent');
  if (!container) return;

  const cached = getSessionCache(CACHE_KEYS.salesImports);
  if (cached) {
    renderSalesImportHistory(cached);
    return;
  }

  container.innerHTML = '<div class="loading-spinner" style="margin:1rem auto;"></div>';
  try {
    const data = await api.getSalesImportHistory();
    const imports = (data && Array.isArray(data.imports)) ? data.imports : [];
    setSessionCache(CACHE_KEYS.salesImports, imports);
    renderSalesImportHistory(imports);
  } catch (err) {
    container.innerHTML = `<div class="sales-state-box">Could not load sales import history. ${escapeHtml(err.message)}</div>`;
  }
}

function renderSalesImportHistory(imports) {
  const container = document.getElementById('salesImportBatchesContent');
  if (!container) return;

  if (!imports.length) {
    container.innerHTML = '<div class="sales-state-box">No sales imports recorded yet.</div>';
    return;
  }

  let html = '';
  imports.forEach(imp => {
    const created = imp.createdAt ? new Date(imp.createdAt) : null;
    const dateLabel = created && !isNaN(created) ? fmtDate(created) : '';
    const timeLabel = created && !isNaN(created) ? fmtTime(created) : '';
    const statusBadge = imp.status === 'cancelled'
      ? '<span class="badge-inactive">CANCELLED</span>'
      : '<span class="badge-active">ACTIVE</span>';
    const products = imp.items || [];
    const productCount = products.length;
    const totalSales = products.reduce((sum, p) => sum + (parseFloat(p.quantity) || 0), 0);

    html += `
      <div class="sales-import-batch" data-import-id="${imp.id}">
        <div class="sales-import-batch-header">
          <span class="sales-import-batch-time">${escapeHtml(dateLabel)}${timeLabel ? ' · ' + escapeHtml(timeLabel) : ''}</span>
          ${statusBadge}
          <button class="sales-import-context-btn" data-import-id="${imp.id}" aria-label="Import actions">•••</button>
        </div>
        <div class="sales-import-batch-meta">${productCount} product${productCount === 1 ? '' : 's'} · ${totalSales} sales</div>
        ${imp.status === 'cancelled' ? '<div style="color:var(--paper-faint);font-size:0.74rem;margin-top:6px;">Stock deductions reversed</div>' : ''}
      </div>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll('.sales-import-context-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const importId = btn.dataset.importId;
      const importData = imports.find(i => i.id === importId);
      if (!importData) return;

      const menuItems = [
        {
          label: 'View import details',
          icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
          action: () => openSalesImportDetails(importData)
        }
      ];

      if (importData.status !== 'cancelled') {
        menuItems.push({
          label: 'Cancel import',
          icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
          danger: true,
          action: () => confirmCancelSalesImport(importData.id)
        });
      }

      openCtx(btn, menuItems);
    });
  });
}

function confirmCancelSalesImport(importId) {
  openConfirm(
    'Cancel Sales Import?',
    'This will reverse the stock deductions created by this sales import.<br>This action cannot be undone.',
    async () => {
      try {
        clearSessionCache(CACHE_KEYS.salesSummary);
        clearSessionCache(CACHE_KEYS.salesImports);
        clearSessionCache(CACHE_KEYS.inventory);

        await api.cancelSalesImport(importId);
        toast('Sales import cancelled and stock restored.');
        await loadSalesImportHistory();
        await loadSalesSummary('today');
        await loadInventory();
      } catch (err) {
        toast(err.message || 'Failed to cancel sales import.', true);
      }
    },
    'Cancel Import'
  );
}

function openSalesImportDetails(importData) {
  const modal = document.getElementById('salesImportDetailsModalOverlay');
  const content = document.getElementById('salesImportDetailsContent');
  const cancelBtn = document.getElementById('salesImportDetailsCancelBtn');
  if (!modal || !content) return;

  const created = importData.createdAt ? new Date(importData.createdAt) : null;
  const dateLabel = created && !isNaN(created) ? fmtDate(created) : '';
  const timeLabel = created && !isNaN(created) ? fmtTime(created) : '';
  const products = importData.items || [];
  const productCount = products.length;
  const totalSales = products.reduce((sum, p) => sum + (parseFloat(p.quantity) || 0), 0);

  let html = `
    <div style="margin-bottom:var(--space-2);color:var(--paper-dim);font-size:0.85rem;">
      ${escapeHtml(dateLabel)}${timeLabel ? ' · ' + escapeHtml(timeLabel) : ''}
      <br>Import #${escapeHtml(importData.id ? importData.id.slice(0, 8) : '')}
    </div>
    <div style="margin-bottom:var(--space-2);color:var(--paper-faint);font-size:0.78rem;">
      ${productCount} product${productCount === 1 ? '' : 's'} · ${totalSales} sales
    </div>
    <div style="border-top:1px solid var(--line);margin-top:var(--space-2);padding-top:var(--space-2);">
  `;

  products.forEach(item => {
    const quantity = parseFloat(item.quantity) || 0;
    const productName = item.productName || 'Unknown';
    const unit = item.unit || '—';
    html += `
      <div class="sales-import-detail-item">
        <span class="sales-import-detail-name">${escapeHtml(productName)}</span>
        <span class="sales-import-detail-qty">${quantity} ${escapeHtml(unit)}</span>
      </div>
    `;
  });

  html += '</div>';
  content.innerHTML = html;

  if (importData.status !== 'cancelled') {
    cancelBtn.classList.remove('hidden');
    cancelBtn.onclick = () => {
      closeModal(modal);
      confirmCancelSalesImport(importData.id);
    };
  } else {
    cancelBtn.classList.add('hidden');
    cancelBtn.onclick = null;
  }

  openModal(modal);
}

document.getElementById('salesImportDetailsCloseBtn').addEventListener('click', () => {
  closeModal(document.getElementById('salesImportDetailsModalOverlay'));
});

window.showSalesDetail = showSalesDetail;
window.handleSalesFileSelect = handleSalesFileSelect;
window.renderSalesPreview = renderSalesPreview;
window.loadSalesSummary = loadSalesSummary;
window.loadSalesImportHistory = loadSalesImportHistory;
window.openSalesImportDetails = openSalesImportDetails;