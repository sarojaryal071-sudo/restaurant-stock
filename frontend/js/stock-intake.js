'use strict';

let editingPurchaseId = null;

function buildItemOptionsHtml(selectedId) {
  let html = '<option value="">-- Select item --</option>';
  state.categories.forEach(c => {
    html += `<optgroup label="${escapeHtml(c.name)}">`;
    c.items.forEach(it => {
      const sel = it.id === selectedId ? ' selected' : '';
      html += `<option value="${it.id}"${sel}>${escapeHtml(it.name)}</option>`;
    });
    html += '</optgroup>';
  });
  return html;
}

function buildPurchaseUnitOptionsHtml(itemId, selectedValue) {
  if (!itemId) return '<option value="">-- Select item first --</option>';
  const f = findItem(itemId);
  const stockUnit = f ? (f.item.unit || '').trim() : '';
  const pkgs = packagesForItem(itemId).filter(p => p.enabled);
  let html = '<option value="">-- Select purchase unit --</option>';
  if (stockUnit) {
    const sel = selectedValue === '__stock__' ? ' selected' : '';
    html += `<option value="__stock__"${sel}>${escapeHtml(stockUnit)}</option>`;
  }
  pkgs.forEach(p => {
    if (stockUnit && p.package_unit && p.package_unit.trim().toLowerCase() === stockUnit.toLowerCase()) return;
    const sel = p.id === selectedValue ? ' selected' : '';
    html += `<option value="${p.id}"${sel}>${escapeHtml(p.package_unit)}</option>`;
  });
  return html;
}

function schedulePurchaseRowPreview(row) {
  if (row._previewTimer) clearTimeout(row._previewTimer);
  row._previewTimer = setTimeout(() => { updatePurchaseRowPreview(row); }, 400);
}

async function updatePurchaseRowPreview(row) {
  const itemSel = row.querySelector('.purchase-item-select');
  const pkgSel = row.querySelector('.purchase-package-select');
  const qtyInput = row.querySelector('.purchase-qty-input');
  const preview = row.querySelector('.purchase-preview');
  const itemId = itemSel.value;
  const unitValue = pkgSel.value;
  const qty = parseFloat(qtyInput.value) || 0;

  row.dataset.previewQuantityAdded = '';
  row.dataset.previewStockUnit = '';
  row.dataset.previewPurchaseUnit = '';

  if (!itemId || !unitValue || qty <= 0) {
    preview.className = 'purchase-preview';
    preview.innerHTML = '';
    updatePurchaseFormValidity();
    return;
  }

  const packageId = unitValue === '__stock__' ? null : unitValue;
  const requestId = (row._previewRequestId = (row._previewRequestId || 0) + 1);
  preview.className = 'purchase-preview is-loading';
  preview.innerHTML = '<span class="purchase-preview-label">Receiving Result</span><span class="purchase-preview-value">Calculating…</span>';
  try {
    const data = await api.previewStockIntake(itemId, packageId, qty);
    if (row._previewRequestId !== requestId) return;
    const calc = data && data.calculation ? data.calculation : null;
    if (!calc) {
      preview.className = 'purchase-preview is-error';
      preview.innerHTML = '<span class="purchase-preview-label">Receiving Result</span><span class="purchase-preview-value">Could not calculate this purchase.</span>';
      updatePurchaseFormValidity();
      return;
    }
    row.dataset.previewQuantityAdded = calc.quantityAdded;
    row.dataset.previewStockUnit = calc.stockUnit || '';
    row.dataset.previewPurchaseUnit = calc.purchaseUnit || '';
    preview.className = 'purchase-preview is-ready';
    preview.innerHTML = `<span class="purchase-preview-label">Receiving Result</span><span class="purchase-preview-value">${calc.quantityPurchased} ${escapeHtml(pluralizeUnit(calc.quantityPurchased, calc.purchaseUnit))} → ${calc.quantityAdded} ${escapeHtml(pluralizeUnit(calc.quantityAdded, calc.stockUnit))}</span>`;
  } catch (e) {
    if (row._previewRequestId !== requestId) return;
    preview.className = 'purchase-preview is-error';
    preview.innerHTML = `<span class="purchase-preview-label">Receiving Result</span><span class="purchase-preview-value">${escapeHtml(e.message || 'Could not calculate this purchase.')}</span>`;
    updatePurchaseFormValidity();
  }
  updatePurchaseFormValidity();
}

function updatePurchaseFormValidity() {
  const rows = document.querySelectorAll('#purchaseItemsList .purchase-modal-item');
  let allValid = rows.length > 0;
  rows.forEach(row => {
    const itemSel = row.querySelector('.purchase-item-select');
    const pkgSel = row.querySelector('.purchase-package-select');
    const qtyInput = row.querySelector('.purchase-qty-input');
    const itemId = itemSel.value;
    const unitValue = pkgSel.value;
    const qty = parseFloat(qtyInput.value) || 0;
    if (!itemId || !unitValue || qty <= 0) { allValid = false; return; }
    if (!row.dataset.previewQuantityAdded) allValid = false;
  });
  const saveBtn = document.getElementById('purchaseSaveBtn');
  if (saveBtn) saveBtn.disabled = !allValid;
  renderPurchaseSummary();
}

function renderPurchaseSummary() {
  const summary = document.getElementById('purchaseSummary');
  if (!summary) return;
  const rows = document.querySelectorAll('#purchaseItemsList .purchase-modal-item');
  const lines = [];
  rows.forEach(row => {
    const itemSel = row.querySelector('.purchase-item-select');
    const qtyInput = row.querySelector('.purchase-qty-input');
    const f = findItem(itemSel.value);
    const qty = parseFloat(qtyInput.value) || 0;
    const valueEl = row.querySelector('.purchase-preview-value');
    const previewText = valueEl ? valueEl.textContent : '';
    if (!f || qty <= 0 || !row.dataset.previewQuantityAdded) return;
    lines.push({ name: f.item.name, preview: previewText });
  });
  if (!lines.length) {
    summary.innerHTML = '';
    return;
  }
  const countLabel = lines.length === 1 ? '1 item receiving' : `${lines.length} items receiving`;
  summary.innerHTML = '<div class="field-label">Purchase Summary</div><div class="purchase-summary-count">' + escapeHtml(countLabel) + '</div>' + lines.map(l => `
    <div class="purchase-summary-line">
      <span>${escapeHtml(l.name)}</span>
      <span class="purchase-summary-qty">${escapeHtml(l.preview)}</span>
    </div>
  `).join('');
}

function addPurchaseRow() {
  const list = document.getElementById('purchaseItemsList');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'purchase-modal-item';
  row.innerHTML = `
    <label class="field-label">Item</label>
    <select class="purchase-item-select intake-item-select">${buildItemOptionsHtml()}</select>
    <div class="purchase-row-grid">
      <div>
        <label class="field-label">Quantity</label>
        <input type="number" min="0" step="0.01" class="purchase-qty-input intake-qty-input" placeholder="Qty">
      </div>
      <div>
        <label class="field-label">Purchase Unit</label>
        <select class="purchase-package-select intake-package-select"><option value="">-- Select item first --</option></select>
      </div>
    </div>
    <div class="purchase-preview"></div>
    <div class="purchase-row-remove-wrap">
      <button class="purchase-row-remove" type="button" aria-label="Remove item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>Remove</span></button>
    </div>
  `;
  const itemSel = row.querySelector('.purchase-item-select');
  const pkgSel = row.querySelector('.purchase-package-select');
  const qtyInput = row.querySelector('.purchase-qty-input');
  const delBtn = row.querySelector('.purchase-row-remove');
  delBtn.addEventListener('click', () => { row.remove(); updatePurchaseFormValidity(); });
  itemSel.addEventListener('change', () => {
    pkgSel.innerHTML = buildPurchaseUnitOptionsHtml(itemSel.value, '');
    schedulePurchaseRowPreview(row);
  });
  pkgSel.addEventListener('change', () => schedulePurchaseRowPreview(row));
  qtyInput.addEventListener('input', () => schedulePurchaseRowPreview(row));
  list.appendChild(row);
  updatePurchaseFormValidity();
  return row;
}

function clearPurchaseModal() {
  document.getElementById('purchaseItemsList').innerHTML = '';
  document.getElementById('purchaseSummary').innerHTML = '';
  document.getElementById('purchaseSaveBtn').disabled = true;
}

function setPurchaseModalMode(editing) {
  const title = document.getElementById('purchaseModalTitle');
  const saveBtn = document.getElementById('purchaseSaveBtn');
  if (title) title.textContent = editing ? 'Edit Purchase' : 'Add Purchase';
  if (saveBtn) saveBtn.textContent = editing ? 'Save Changes' : 'Save Purchase';
}

function openAddPurchaseModal() {
  editingPurchaseId = null;
  clearPurchaseModal();
  setPurchaseModalMode(false);
  const dateInput = document.getElementById('purchaseDateInput');
  if (dateInput) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    dateInput.value = `${yyyy}-${mm}-${dd}`;
  }
  addPurchaseRow();
  openModal(document.getElementById('purchaseModalOverlay'));
}

function populatePurchaseRow(row, item) {
  const itemSel = row.querySelector('.purchase-item-select');
  const pkgSel = row.querySelector('.purchase-package-select');
  const qtyInput = row.querySelector('.purchase-qty-input');

  itemSel.value = item.itemId || '';
  pkgSel.innerHTML = buildPurchaseUnitOptionsHtml(itemSel.value, item.packageId || '__stock__');
  qtyInput.value = item.quantityPurchased !== undefined && item.quantityPurchased !== null
    ? item.quantityPurchased
    : 0;

  schedulePurchaseRowPreview(row);
}

function openEditPurchaseModal(intake) {
  editingPurchaseId = intake.id;
  clearPurchaseModal();
  setPurchaseModalMode(true);

  const dateInput = document.getElementById('purchaseDateInput');
  if (dateInput) {
    const d = intake.purchaseDate || (intake.createdAt ? intake.createdAt.slice(0, 10) : '');
    dateInput.value = d;
  }

  const items = intake.items || [];
  if (!items.length) {
    addPurchaseRow();
  } else {
    items.forEach(item => {
      const row = addPurchaseRow();
      populatePurchaseRow(row, item);
    });
  }

  openModal(document.getElementById('purchaseModalOverlay'));
}

async function loadPurchaseRegister() {
  const container = document.getElementById('stockIntakeContainer');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner" style="margin:2rem auto;"></div>';
  try {
    await loadPackagesIfNeeded();
    const data = await api.getStockIntake();
    const intakes = (data && Array.isArray(data.intakes)) ? data.intakes : [];
    cachedStockIntakeData = intakes;
    renderPurchaseRegister(intakes);
  } catch (e) {
    container.innerHTML = `<div class="empty-state show"><div>Could not load purchase history. ${escapeHtml(e.message)}</div></div>`;
  }
}

function renderPurchaseRegister(intakes) {
  const container = document.getElementById('stockIntakeContainer');
  if (!container) return;
  const sorted = [...intakes].sort((a, b) => {
    const ad = a.purchaseDate || (a.createdAt ? a.createdAt.slice(0, 10) : '');
    const bd = b.purchaseDate || (b.createdAt ? b.createdAt.slice(0, 10) : '');
    if (ad !== bd) return bd.localeCompare(ad);
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const grouped = {};
  const order = [];
  sorted.forEach(intake => {
    const key = intake.purchaseDate || (intake.createdAt ? intake.createdAt.slice(0, 10) : 'unknown');
    if (!grouped[key]) { grouped[key] = []; order.push(key); }
    grouped[key].push(intake);
  });

  let html = `
    <div class="purchase-register-toolbar">
      <div>
        <div class="purchase-register-title">Purchase Register</div>
        <div class="purchase-register-subtitle">Received inventory and stock purchases</div>
      </div>
      <button class="btn btn-gold btn-small" id="addPurchaseBtn">+ Add Purchase</button>
    </div>
  `;

  if (!sorted.length) {
    html += '<div class="empty-state show"><div>No purchases recorded yet.</div></div>';
  } else {
    order.forEach(key => {
      const dateObj = key && key !== 'unknown' ? new Date(key + 'T00:00:00') : null;
      const groupLabel = dateObj && !isNaN(dateObj) ? fmtDate(dateObj).toUpperCase() : 'UNDATED';
      html += `<div class="purchase-group-title">${escapeHtml(groupLabel)}</div>`;
      grouped[key].forEach(intake => {
        const enteredDt = intake.createdAt ? new Date(intake.createdAt) : null;
        const enteredTime = enteredDt ? fmtTime(enteredDt) : '';
        const items = intake.items || [];
        const itemRows = items.map(it => {
          const f = findItem(it.itemId);
          const stockUnit = f ? (f.item.unit || '') : '';
          const qtyPurchased = it.quantityPurchased !== undefined && it.quantityPurchased !== null ? parseFloat(it.quantityPurchased) : null;
          const quantityAdded = it.quantityAdded !== undefined ? parseFloat(it.quantityAdded) : null;
          const packageUnit = it.packageUnit || '';
          let resultLine;
          if (packageUnit && qtyPurchased !== null && quantityAdded !== null) {
            resultLine = `${qtyPurchased} ${escapeHtml(pluralizeUnit(qtyPurchased, packageUnit))} → ${quantityAdded} ${escapeHtml(pluralizeUnit(quantityAdded, stockUnit || packageUnit))}`;
          } else if (quantityAdded !== null) {
            resultLine = `${quantityAdded} ${escapeHtml(pluralizeUnit(quantityAdded, stockUnit))}`;
          } else {
            resultLine = '—';
          }
          return `<div class="purchase-card-item">
            <span class="purchase-item-name">${escapeHtml(it.itemName || 'Item')}</span>
            <span class="purchase-item-result">${resultLine}</span>
          </div>`;
        }).join('');
        const statusBadge = intake.status === 'cancelled'
          ? '<span class="badge-inactive">Cancelled</span>'
          : '<span class="badge-active">Active</span>';

        const actionButtons = intake.status !== 'cancelled'
          ? `<div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px;">
              <button class="btn btn-ghost btn-small purchase-edit-btn" data-intake-id="${intake.id}">Edit</button>
              <button class="btn btn-danger btn-small purchase-cancel-btn" data-intake-id="${intake.id}">Cancel</button>
            </div>`
          : '';

        html += `<div class="purchase-card" data-intake-id="${intake.id}">
          <div class="purchase-card-header">
            <span class="purchase-card-time">${escapeHtml(enteredTime ? 'Entered ' + enteredTime : '')}</span>
            ${statusBadge}
            <span class="purchase-card-id">${intake.id ? '#' + intake.id.slice(0, 8) : ''}</span>
          </div>
          ${actionButtons}
          <div class="purchase-card-body">${itemRows || '<div class="purchase-card-item"><span class="purchase-item-name">No items</span></div>'}</div>
        </div>`;
      });
    });
  }

  container.innerHTML = html;

  document.getElementById('addPurchaseBtn').addEventListener('click', openAddPurchaseModal);

  container.querySelectorAll('.purchase-card').forEach(card => {
    card.addEventListener('click', () => {
      const intake = sorted.find(i => i.id === card.dataset.intakeId);
      if (intake) openPurchaseDetails(intake);
    });
  });

  container.querySelectorAll('.purchase-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const intake = sorted.find(i => i.id === btn.dataset.intakeId);
      if (intake) openEditPurchaseModal(intake);
    });
  });

  container.querySelectorAll('.purchase-cancel-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const intake = sorted.find(i => i.id === btn.dataset.intakeId);
      if (intake) confirmCancelPurchase(intake);
    });
  });
}

function openPurchaseDetails(intake) {
  const content = document.getElementById('purchaseDetailsContent');
  const purchaseDt = intake.purchaseDate ? new Date(intake.purchaseDate + 'T00:00:00') : (intake.createdAt ? new Date(intake.createdAt) : new Date());
  const dateLabel = !isNaN(purchaseDt) ? fmtDate(purchaseDt) : '';
  const enteredDt = intake.createdAt ? new Date(intake.createdAt) : null;
  const enteredTime = enteredDt ? fmtTime(enteredDt) : '';
  const items = intake.items || [];
  let html = `<div style="font-size:0.85rem;color:var(--paper-dim);margin-bottom:var(--space-3);">${escapeHtml(dateLabel)}${enteredTime ? ' · Entered ' + escapeHtml(enteredTime) : ''}</div>`;
  items.forEach(item => {
    const f = findItem(item.itemId);
    const stockUnit = f ? (f.item.unit || '') : '';
    const qtyPurchased = item.quantityPurchased !== undefined && item.quantityPurchased !== null ? parseFloat(item.quantityPurchased) : null;
    const quantityAdded = item.quantityAdded !== undefined ? parseFloat(item.quantityAdded) : null;
    const packageUnit = item.packageUnit || '';
    let resultLine;
    if (packageUnit && qtyPurchased !== null && quantityAdded !== null) {
      resultLine = `${qtyPurchased} ${pluralizeUnit(qtyPurchased, packageUnit)} → ${quantityAdded} ${pluralizeUnit(quantityAdded, stockUnit || packageUnit)}`;
    } else if (quantityAdded !== null) {
      resultLine = `${quantityAdded} ${pluralizeUnit(quantityAdded, stockUnit)}`;
    } else {
      resultLine = '—';
    }
    html += `<div class="purchase-summary-line">
      <span>${escapeHtml(item.itemName || 'Item')}</span>
      <span class="purchase-summary-qty">${escapeHtml(resultLine)}</span>
    </div>`;
  });
  html += `<div style="margin-top:var(--space-3);padding-top:var(--space-2);border-top:1px solid var(--line);font-size:0.8rem;color:var(--paper-faint);">Total items: ${items.length}</div>`;
  if (intake.status !== 'cancelled') {
    html += `<div style="display:flex;gap:6px;margin-top:var(--space-3);">
      <button class="btn btn-ghost btn-small" id="purchaseDetailsEditBtn">Edit</button>
      <button class="btn btn-danger btn-small" id="purchaseDetailsCancelBtn">Cancel Purchase</button>
    </div>`;
  }

  content.innerHTML = html;

  const detailsEditBtn = document.getElementById('purchaseDetailsEditBtn');
  if (detailsEditBtn) {
    detailsEditBtn.addEventListener('click', () => {
      closeModal(document.getElementById('purchaseDetailsModalOverlay'));
      openEditPurchaseModal(intake);
    });
  }

  const detailsCancelBtn = document.getElementById('purchaseDetailsCancelBtn');
  if (detailsCancelBtn) {
    detailsCancelBtn.addEventListener('click', () => {
      closeModal(document.getElementById('purchaseDetailsModalOverlay'));
      confirmCancelPurchase(intake);
    });
  }

  openModal(document.getElementById('purchaseDetailsModalOverlay'));
}

function confirmCancelPurchase(intake) {
  openConfirm(
    'Cancel Purchase',
    'Cancel this purchase? The stock previously received will be reversed.',
    async () => {
      try {
        await api.cancelStockIntake(intake.id);
        toast('Purchase cancelled. Stock corrected.');
        await loadPurchaseRegister();
        await loadInventory();
      } catch (e) {
        toast(e.message || 'Failed to cancel purchase.', true);
      }
    },
    'Cancel Purchase'
  );
}

function showStockIntakePage() {
  if (cachedStockIntakeData) {
    renderPurchaseRegister(cachedStockIntakeData);
  } else {
    loadPurchaseRegister();
  }
}

document.getElementById('addPurchaseItemBtn').addEventListener('click', () => { addPurchaseRow(); });
document.getElementById('purchaseCancelBtn').addEventListener('click', () => { closeModal(document.getElementById('purchaseModalOverlay')); clearPurchaseModal(); });
document.getElementById('purchaseDetailsCloseBtn').addEventListener('click', () => { closeModal(document.getElementById('purchaseDetailsModalOverlay')); });

document.getElementById('purchaseSaveBtn').addEventListener('click', async () => {
  const rows = document.querySelectorAll('#purchaseItemsList .purchase-modal-item');
  const items = [];
  let allValid = true;
  rows.forEach(row => {
    const itemId = row.querySelector('.purchase-item-select').value;
    const qty = parseFloat(row.querySelector('.purchase-qty-input').value);
    const pkgSel = row.querySelector('.purchase-package-select');
    const unitValue = pkgSel.value;
    if (!itemId || !unitValue || !qty || qty <= 0) { allValid = false; return; }
    const entry = { itemId, quantityPurchased: qty };
    if (unitValue !== '__stock__') entry.packageId = unitValue;
    items.push(entry);
  });
  if (!allValid || !items.length) { toast('Add at least one valid item.', true); return; }
  const purchaseDateInput = document.getElementById('purchaseDateInput');
  const purchaseDate = purchaseDateInput && purchaseDateInput.value ? purchaseDateInput.value : undefined;
  const btn = document.getElementById('purchaseSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    if (editingPurchaseId) {
      await api.updateStockIntake(editingPurchaseId, items, purchaseDate);
      toast('Purchase updated. Inventory corrected.');
    } else {
      await api.createStockIntake(items, purchaseDate);
      toast('Purchase recorded. Inventory updated.');
    }

    closeModal(document.getElementById('purchaseModalOverlay'));
    clearPurchaseModal();
    editingPurchaseId = null;
    await loadPurchaseRegister();
    await loadInventory();
  } catch (e) {
    toast(e.message || 'Failed to save purchase.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = editingPurchaseId ? 'Save Changes' : 'Save Purchase';
  }
});

window.buildItemOptionsHtml = buildItemOptionsHtml;
window.buildPurchaseUnitOptionsHtml = buildPurchaseUnitOptionsHtml;
window.schedulePurchaseRowPreview = schedulePurchaseRowPreview;
window.updatePurchaseRowPreview = updatePurchaseRowPreview;
window.updatePurchaseFormValidity = updatePurchaseFormValidity;
window.renderPurchaseSummary = renderPurchaseSummary;
window.addPurchaseRow = addPurchaseRow;
window.clearPurchaseModal = clearPurchaseModal;
window.openAddPurchaseModal = openAddPurchaseModal;
window.loadPurchaseRegister = loadPurchaseRegister;
window.renderPurchaseRegister = renderPurchaseRegister;
window.openPurchaseDetails = openPurchaseDetails;
window.showStockIntakePage = showStockIntakePage;