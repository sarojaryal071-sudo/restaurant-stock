'use strict';

function showSalesDetail() {
  const content = document.getElementById('settingsDetailContent');
  if (!content) return;
  content.innerHTML = `
    <div id="salesUploadSection" class="sales-summary-card" style="margin-top:0;">
      <div class="sales-summary-header">
        <div class="sales-summary-title">Upload Sales CSV</div>
        <div class="sales-summary-desc">Import a new POS sales report.</div>
      </div>
      <label class="file-upload-wrap" for="salesCsvFile">
        <span class="file-upload-btn">Choose CSV File</span>
        <span class="file-upload-filename" id="salesCsvFileName">No file selected</span>
      </label>
      <input type="file" id="salesCsvFile" accept=".csv" class="file-upload-input">
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
    <thead><tr><th>POS Product</th><th>Resolved To</th><th>Qty Sold</th><th>Unit</th><th>Status</th></tr></thead><tbody>`;

  salesItems.forEach((item, idx) => {
    const badge = getSalesPreviewBadge(item);
    let resolvedTo = '—';

    if (item.matched && item.type === 'inventory') {
      resolvedTo = escapeHtml(item.itemName || '—');
    } else if (item.matched && item.type === 'recipe') {
      resolvedTo = escapeHtml(item.recipeName || '—');
    } else if (!item.matched) {
      resolvedTo = `<select class="field-select" id="mapSelect_${idx}" style="width:auto;min-width:160px;display:inline-block;padding:8px 10px;font-size:0.82rem;"><option value="">-- Select --</option></select>`;
    }

    const unitLabel = item.matched && item.type === 'inventory'
      ? escapeHtml(item.unit || '—')
      : '—';

    html += `<tr>
      <td>${escapeHtml(item.sourceProductName)}</td>
      <td>${resolvedTo}</td>
      <td>${item.quantitySold}</td>
      <td>${unitLabel}</td>
      <td>${badge}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  html += `<button id="applySalesBtn" class="btn btn-gold btn-small" style="margin-top:var(--space-2);" ${salesItems.some(it => !it.matched) ? 'disabled' : ''}>Apply Sales</button>`;
  previewDiv.innerHTML = html;

  salesItems.forEach((item, idx) => {
    if (!item.matched) {
      const select = document.getElementById(`mapSelect_${idx}`);
      if (!select) return;

      state.categories.forEach(cat => {
        cat.items.forEach(it => {
          const option = document.createElement('option');
          option.value = it.id;
          option.textContent = it.name;
          select.appendChild(option);
        });
      });

      select.addEventListener('change', async (e) => {
        const itemId = e.target.value;
        if (!itemId) return;

        try {
          await api.saveSalesMapping(item.sourceProductName, itemId);
          item.itemId = itemId;
          item.itemName = e.target.selectedOptions[0].textContent;
          item.recipeId = null;
          item.recipeName = null;
          item.type = 'inventory';
          item.matched = true;
          renderSalesPreview();
          toast('Mapping saved.');
        } catch (err) {
          toast(err.message || 'Failed to save mapping', true);
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
            unit: it.type === 'inventory' ? (it.unit || null) : null
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

  overviewDiv.innerHTML = '<div class="loading-spinner" style="margin:1rem auto;"></div>';
  recordsDiv.innerHTML = '';

  try {
    const data = await api.getSalesSummary(period);
    const summary = (data && data.summary && Array.isArray(data.summary)) ? data.summary : [];

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
    <thead><tr><th>Product</th><th>Quantity</th><th>Type</th></tr></thead><tbody>`;

  summary.forEach(s => {
    const productName = s.product || s.itemName || 'Unknown';
    const quantity = s.quantity ?? s.totalSold ?? 0;
    const type = s.type || 'Sales'; // Fallback if backend provides type later

    let typeLabel = '';
    if (type === 'inventory') typeLabel = '<span class="sales-record-type">📦 Inventory</span>';
    else if (type === 'recipe') typeLabel = '<span class="sales-record-type">🥃 Recipe</span>';
    else typeLabel = '<span class="sales-record-type">—</span>';

    html += `<tr>
      <td>${escapeHtml(productName)}</td>
      <td>${quantity}</td>
      <td>${typeLabel}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  recordsDiv.innerHTML = html;
}

async function loadSalesImportHistory() {
  const container = document.getElementById('salesImportHistoryContent');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner" style="margin:1rem auto;"></div>';
  try {
    const data = await api.getSalesImportHistory();
    const imports = (data && Array.isArray(data.imports)) ? data.imports : [];
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