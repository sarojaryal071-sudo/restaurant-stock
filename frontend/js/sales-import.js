'use strict';

function showSalesDetail() {
  const content = document.getElementById('settingsDetailContent');
  if (!content) return;
  content.innerHTML = `
    <div id="salesImportSection" class="sales-summary-card" style="margin-top:0;">
      <div class="sales-summary-header">
        <div class="sales-summary-title">Sales Import</div>
        <div class="sales-summary-desc">Import your POS sales report to automatically deduct sold drinks from inventory.</div>
      </div>
      <label class="file-upload-wrap" for="salesCsvFile">
        <span class="file-upload-btn">Choose CSV File</span>
        <span class="file-upload-filename" id="salesCsvFileName">No file selected</span>
      </label>
      <input type="file" id="salesCsvFile" accept=".csv" class="file-upload-input">
      <div id="salesImportPreview"></div>
    </div>
    <div id="salesImportHistorySection" class="sales-summary-card">
      <div class="sales-summary-header">
        <div class="sales-summary-title">Sales Import History</div>
        <div class="sales-summary-desc">Previously imported sales reports and their status.</div>
      </div>
      <div id="salesImportHistoryContent"></div>
    </div>
    <div id="salesSummarySection" class="sales-summary-card">
      <div class="sales-summary-header">
        <div class="sales-summary-title">Sales Summary</div>
        <div class="sales-summary-desc">Quantities sold per item for the selected period.</div>
      </div>
      <div id="salesSummaryContent"></div>
    </div>
  `;
  document.getElementById('salesCsvFile').addEventListener('change', handleSalesFileSelect);
  loadSalesImportHistory();
  loadSalesSummary('today');
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
  const summaryDiv = document.getElementById('salesSummaryContent');
  if (!summaryDiv) return;
  summaryDiv.innerHTML = '<div class="loading-spinner" style="margin:1rem auto;"></div>';
  try {
    const data = await api.getSalesSummary(period);
    const summary = (data && data.summary && Array.isArray(data.summary)) ? data.summary : [];

    let html = `<div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-3);flex-wrap:wrap;">
      <button class="btn btn-ghost btn-small period-btn" data-period="today">Today</button>
      <button class="btn btn-ghost btn-small period-btn" data-period="7days">Last 7 days</button>
      <button class="btn btn-ghost btn-small period-btn" data-period="30days">Last 30 days</button>
      <button class="btn btn-ghost btn-small period-btn" data-period="month">This Month</button>
    </div>`;

    if (!summary.length) {
      html += '<p style="font-size:0.82rem;color:var(--paper-faint);">No sales recorded for this period.</p>';
    } else {
      html += `<table class="staff-table"><thead><tr><th>Entry Date</th><th>Product</th><th>Quantity Sold</th><th>Unit</th></tr></thead><tbody>`;
      summary.forEach(s => {
        const productName = s.product || s.itemName || 'Unknown';
        const quantity = s.quantity ?? s.totalSold ?? 0;
        const entryDate = s.date || '';
        const unitLabel = s.unit || '—';
        html += `<tr>
          <td>${escapeHtml(entryDate)}</td>
          <td>${escapeHtml(productName)}</td>
          <td>${quantity}</td>
          <td>${escapeHtml(unitLabel)}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }

    summaryDiv.innerHTML = html;

    summaryDiv.querySelectorAll('.period-btn').forEach(btn => {
      if (btn.dataset.period === period) btn.classList.add('btn-gold');
      btn.addEventListener('click', () => loadSalesSummary(btn.dataset.period));
    });
  } catch (err) {
    summaryDiv.innerHTML = '<p style="font-size:0.82rem;color:var(--danger);">Failed to load sales summary.</p>';
  }
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
  const container = document.getElementById('salesImportHistoryContent');
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

    const cancelBtn = imp.status !== 'cancelled'
      ? `<button class="btn btn-danger btn-small sales-import-cancel-btn" data-import-id="${imp.id}">Cancel Import</button>`
      : '<div style="color:var(--paper-faint);font-size:0.74rem;margin-top:6px;">Stock deductions reversed</div>';

    html += `
      <div class="purchase-card" data-import-id="${imp.id}">
        <div class="purchase-card-header">
          <span class="purchase-card-time">${escapeHtml(dateLabel)}${timeLabel ? ' · ' + escapeHtml(timeLabel) : ''}</span>
          ${statusBadge}
          <span class="purchase-card-id">${imp.id ? '#' + imp.id.slice(0, 8) : ''}</span>
        </div>
        <div class="purchase-card-body">
          ${productCount} product${productCount === 1 ? '' : 's'} · ${totalSales} sales
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:8px;">${cancelBtn}</div>
      </div>
    `;
  });

  container.innerHTML = html;

  container.querySelectorAll('.sales-import-cancel-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmCancelSalesImport(btn.dataset.importId);
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

window.showSalesDetail = showSalesDetail;
window.handleSalesFileSelect = handleSalesFileSelect;
window.renderSalesPreview = renderSalesPreview;
window.loadSalesSummary = loadSalesSummary;
window.loadSalesImportHistory = loadSalesImportHistory;