'use strict';

const rootEl = document.getElementById('categoriesRoot');

function render() {
  rootEl.innerHTML = '';
  state.categories.forEach(c => rootEl.appendChild(renderCat(c)));
  document.getElementById('inventoryEmptyHero').classList.toggle('show', state.categories.length === 0);
  updateOverview();
  applySearchFilter();
  updateDirty();
}

function renderCat(c) {
  const card = document.createElement('div');
  card.className = 'cat-card' + (expandedState[c.id] ? ' expanded' : '');
  card.dataset.catId = c.id;
  const h = document.createElement('button');
  h.className = 'cat-header';
  h.setAttribute('aria-expanded', expandedState[c.id] ? 'true' : 'false');
  h.innerHTML = `<div class="cat-icon">${ICONS[c.icon] || ICONS.default}</div><div class="cat-title-wrap"><div class="cat-name">${escapeHtml(c.name)}</div><div class="cat-count"><b>${c.items.length}</b> item${c.items.length === 1 ? '' : 's'}</div></div><svg class="cat-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>`;
  if (can('categories', 'edit') || can('categories', 'delete')) {
    const mb = document.createElement('button');
    mb.className = 'cat-menu-btn';
    mb.setAttribute('aria-label', 'Category menu');
    mb.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
    mb.addEventListener('click', ev => {
      ev.stopPropagation();
      const items = [];
      if (can('categories', 'edit')) items.push({
        label: 'Rename Category',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
        action: () => openCatDialog('rename', c)
      });
      if (can('categories', 'delete')) items.push({
        label: 'Delete Category',
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
        danger: true,
        action: () => delCat(c)
      });
      if (items.length) openCtx(mb, items);
    });
    h.appendChild(mb);
  }
  h.addEventListener('click', ev => {
    if (ev.target.closest('.cat-menu-btn')) return;
    expandedState[c.id] = !expandedState[c.id];
    card.classList.toggle('expanded');
    h.setAttribute('aria-expanded', expandedState[c.id] ? 'true' : 'false');
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(expandedState)); } catch (e) { }
  });
  const body = document.createElement('div');
  body.className = 'cat-body';
  const bi = document.createElement('div');
  bi.className = 'cat-body-inner';
  c.items.forEach(it => bi.appendChild(renderItemRow(c, it)));
  body.appendChild(bi);
  card.appendChild(h);
  card.appendChild(body);
  return card;
}

function renderItemRowOrig(c, it) {
  const row = document.createElement('div');
  row.className = 'item-row' + (it.qty !== it.lastConfirmedQty ? ' is-pending' : '');
  row.dataset.itemId = it.id;
  row.dataset.itemName = it.name.toLowerCase();
  row.addEventListener('click', e => { if (e.target.closest('button')) return; setActive(it.id); });
  const ne = document.createElement('div');
  ne.className = 'item-name';
  ne.innerHTML = escapeHtml(it.name) + (it.custom ? '<span class="custom-tag">Custom</span>' : '');
  const ctrls = document.createElement('div');
  ctrls.className = 'qty-controls';
  const mb = document.createElement('button');
  mb.className = 'qty-btn minus';
  mb.setAttribute('aria-label', 'Decrease');
  mb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/></svg>';
  mb.addEventListener('click', e => { e.stopPropagation(); changeQty(it.id, -1); });
        const qtyWrap = document.createElement('div');
        qtyWrap.className = 'qty-wrap';

        const qe = document.createElement('input');
        qe.type = 'number';
        qe.step = 'any';
        qe.inputMode = 'decimal';
        qe.className = 'qty-value qty-input ' + qtyClass(it.qty);
        qe.value = it.qty;

        // Allow negative values only when backend setting permits it
        if (!(settingsData && settingsData.inventoryBehaviour && settingsData.inventoryBehaviour.negativeStockAllowed)) {
          qe.min = '0';
        }

        qe.addEventListener('input', e => {
          const val = parseFloat(e.target.value);
          if (isNaN(val)) return;
          it.qty = val;
          updateItemRowUI(it.id, it);
          updateOverview();
          updateDirty();
          setActive(it.id);
        });

        const remaining = document.createElement('div');
        remaining.className = 'qty-remaining';
        remaining.classList.add('hidden');
        qtyWrap.appendChild(qe);
        qtyWrap.appendChild(remaining);
  const pb = document.createElement('button');
  pb.className = 'qty-btn plus';
  pb.setAttribute('aria-label', 'Increase');
  pb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  pb.addEventListener('click', e => { e.stopPropagation(); changeQty(it.id, 1); });
        ctrls.appendChild(mb); ctrls.appendChild(qtyWrap); ctrls.appendChild(pb);

        const hasRemainder = Number(it.remainingVolume) > 0 || Math.floor(Number(it.qty)) !== Number(it.qty);
        if (it.remainingVolume !== undefined && it.remainingVolume !== null && it.remainingVolumeUnit && hasRemainder) {
          remaining.textContent = `${Math.floor(Number(it.qty) || 0)} : ${it.remainingVolume} ${it.remainingVolumeUnit}`;
          remaining.classList.remove('hidden');
        }

  const editable = it.editable !== false && it.locked !== true;
  const canEditItem = can('inventory', 'edit');
  const canDeleteItem = can('inventory', 'delete');
  let mnb = null;
  if ((canEditItem || canDeleteItem) && editable) {
    mnb = document.createElement('button');
    mnb.className = 'item-menu-btn';
    mnb.setAttribute('aria-label', 'Item menu');
    mnb.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>';
    mnb.addEventListener('click', e => {
      e.stopPropagation();
      setActive(it.id);
      const ctxItems = [];
      if (canEditItem) ctxItems.push({ label: 'Edit Item', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>', action: () => openEditItem(it) });
      if (canDeleteItem) ctxItems.push({ label: 'Delete Item', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>', danger: true, action: () => delItem(it) });
      if (ctxItems.length) openCtx(mnb, ctxItems);
    });
  }
  row.appendChild(ne);
  row.appendChild(ctrls);
  if (mnb) row.appendChild(mnb);
  return row;
}

function renderItemRow(c, it) {
  const row = renderItemRowOrig(c, it);
  if (it.qty < 0) {
    const warning = document.createElement('span');
    warning.className = 'pending-warning';
    warning.innerHTML = '⚠ Pending Allocation';
    warning.addEventListener('click', (e) => {
      e.stopPropagation();
      shouldOpenAllocations = true;
      switchPage('recipes');
    });
    row.querySelector('.item-name').appendChild(warning);
  }
  return row;
}

function updateOverview() {
  let t = 0, inS = 0, out = 0;
  state.categories.forEach(c => c.items.forEach(it => {
    t++;
    if (it.qty > 0) inS++;
    else out++;
  }));
  document.getElementById('statTotalItems').textContent = t;
  document.getElementById('statInStock').textContent = inS;
  document.getElementById('statOutStock').textContent = out;
}

function changeQty(iid, delta) {
  const f = findItem(iid);
  if (!f) return;
  const { item } = f;
  const nq = Math.max(0, item.qty + delta);
  if (nq === item.qty) return;
  item.qty = nq;
  updateItemRowUI(iid, item);
  updateOverview();
  updateDirty();
  setActive(iid);
}

      function updateItemRowUI(iid, it) {
        const row = rootEl.querySelector(`.item-row[data-item-id="${cssEscape(iid)}"]`);
        if (!row) return;
        const q = row.querySelector('.qty-value');
        if (q) {
          q.value = it.qty;
          q.className = 'qty-value qty-input ' + qtyClass(it.qty);
        }

        const rem = row.querySelector('.qty-remaining');
        if (rem) {
          const hasRemainder = Number(it.remainingVolume) > 0 || Math.floor(Number(it.qty)) !== Number(it.qty);
          if (it.remainingVolume !== undefined && it.remainingVolume !== null && it.remainingVolumeUnit && hasRemainder) {
            const wholeUnits = Math.floor(Number(it.qty) || 0);
            rem.textContent = `${wholeUnits} : ${it.remainingVolume} ${it.remainingVolumeUnit}`;
            rem.classList.remove('hidden');
          } else {
            rem.classList.add('hidden');
          }
        }

        row.classList.toggle('is-pending', it.qty !== it.lastConfirmedQty);
      }

function dirtyUpdates() {
  const u = [];
  state.categories.forEach(c => c.items.forEach(it => {
    if (it.qty !== it.lastConfirmedQty) u.push({ itemId: it.id, quantity: it.qty });
  }));
  return u;
}

function isDirtyFn() {
  return state.categories.some(c => c.items.some(it => it.qty !== it.lastConfirmedQty));
}

function updateDirty() {
  isDirty = isDirtyFn();
  if (currentPage === 'inventory') svBtn.classList.toggle('hidden', !isDirty);
}

function revertAll() {
  state.categories.forEach(c => c.items.forEach(it => { it.qty = it.lastConfirmedQty; }));
  render();
}

function setActive(iid) {
  if (activeItemId === iid) return;
  if (activeItemId) {
    const r = document.querySelector(`.item-row[data-item-id="${cssEscape(activeItemId)}"]`);
    if (r) r.classList.remove('active');
  }
  activeItemId = iid;
  const r = document.querySelector(`.item-row[data-item-id="${cssEscape(iid)}"]`);
  if (r) r.classList.add('active');
}

function clearActive() {
  if (activeItemId) {
    const r = document.querySelector(`.item-row[data-item-id="${cssEscape(activeItemId)}"]`);
    if (r) r.classList.remove('active');
    activeItemId = null;
  }
}

document.addEventListener('click', e => {
  if (!e.target.closest('.item-row')) clearActive();
});

      function refreshItem(id) {
        const f = findItem(id);
        if (!f) return;
        const { item } = f;
        const row = document.querySelector(`.item-row[data-item-id="${cssEscape(id)}"]`);
        if (!row) return;
        row.querySelector('.item-name').innerHTML = escapeHtml(item.name) + (item.custom ? '<span class="custom-tag">Custom</span>' : '');
        const q = row.querySelector('.qty-value');
        if (q) {
          q.value = item.qty;
          q.className = 'qty-value qty-input ' + qtyClass(item.qty);
        }

        const rem = row.querySelector('.qty-remaining');
        if (rem) {
          const hasRemainder = Number(item.remainingVolume) > 0 || Math.floor(Number(item.qty)) !== Number(item.qty);
          if (item.remainingVolume !== undefined && item.remainingVolume !== null && item.remainingVolumeUnit && hasRemainder) {
            const wholeUnits = Math.floor(Number(item.qty) || 0);
            rem.textContent = `${wholeUnits} : ${item.remainingVolume} ${item.remainingVolumeUnit}`;
            rem.classList.remove('hidden');
          } else {
            rem.classList.add('hidden');
          }
        }

        row.classList.toggle('is-pending', item.qty !== item.lastConfirmedQty);
        row.dataset.itemName = item.name.toLowerCase();
      }

function refreshCat(cid) {
  const c = findCat(cid);
  if (!c) return;
  const card = document.querySelector(`.cat-card[data-cat-id="${cssEscape(cid)}"]`);
  if (!card) return;
  const bi = card.querySelector('.cat-body-inner');
  bi.innerHTML = '';
  c.items.forEach(it => bi.appendChild(renderItemRow(c, it)));
  const ce = card.querySelector('.cat-count b');
  if (ce) ce.textContent = c.items.length;
  const ct = card.querySelector('.cat-count');
  if (ct) {
    const s = c.items.length === 1 ? ' item' : ' items';
    ct.innerHTML = '<b>' + c.items.length + '</b>' + s;
  }
}

function appendCat(cat) {
  const card = renderCat(cat);
  rootEl.appendChild(card);
  expandedState[cat.id] = true;
  card.classList.add('expanded');
  const h = card.querySelector('.cat-header');
  if (h) h.setAttribute('aria-expanded', 'true');
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(expandedState)); } catch (e) { }
  applySearchFilter();
  updateOverview();
}

function removeCat(cid) {
  const card = document.querySelector(`.cat-card[data-cat-id="${cssEscape(cid)}"]`);
  if (card) card.remove();
  delete expandedState[cid];
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify(expandedState)); } catch (e) { }
  updateOverview();
  saveCache();
}

function moveItem(iid, ocid, ncid) {
  const oc = findCat(ocid);
  const nc = findCat(ncid);
  if (!oc || !nc) return;
  const idx = oc.items.findIndex(i => i.id === iid);
  if (idx === -1) return;
  const item = oc.items[idx];
  oc.items.splice(idx, 1);
  nc.items.push(item);
  refreshCat(ocid);
  refreshCat(ncid);
  updateOverview();
  applySearchFilter();
}

function appendItem(cid, item) {
  const c = findCat(cid);
  if (!c) return;
  c.items.push(item);
  const card = document.querySelector(`.cat-card[data-cat-id="${cssEscape(cid)}"]`);
  if (card) {
    card.querySelector('.cat-body-inner').appendChild(renderItemRow(c, item));
    const ce = card.querySelector('.cat-count b');
    if (ce) ce.textContent = c.items.length;
    const ct = card.querySelector('.cat-count');
    if (ct) {
      const s = c.items.length === 1 ? ' item' : ' items';
      ct.innerHTML = '<b>' + c.items.length + '</b>' + s;
    }
  }
  updateOverview();
  applySearchFilter();
}

function removeItem(iid) {
  const f = findItem(iid);
  if (!f) return;
  const { cat, item } = f;
  const idx = cat.items.indexOf(item);
  if (idx !== -1) cat.items.splice(idx, 1);
  const row = document.querySelector(`.item-row[data-item-id="${cssEscape(iid)}"]`);
  if (row) row.remove();
  const card = document.querySelector(`.cat-card[data-cat-id="${cssEscape(cat.id)}"]`);
  if (card) {
    const ce = card.querySelector('.cat-count b');
    if (ce) ce.textContent = cat.items.length;
    const ct = card.querySelector('.cat-count');
    if (ct) {
      const s = cat.items.length === 1 ? ' item' : ' items';
      ct.innerHTML = '<b>' + cat.items.length + '</b>' + s;
    }
  }
  updateOverview();
  updateDirty();
  applySearchFilter();
  saveCache();
}

const searchInput = document.getElementById('searchInput');
searchInput.addEventListener('input', applySearchFilter);

function applySearchFilter() {
  const q = searchInput.value.trim().toLowerCase();
  let any = false;
  state.categories.forEach(c => {
    const card = rootEl.querySelector(`.cat-card[data-cat-id="${cssEscape(c.id)}"]`);
    if (!card) return;
    let vc = 0;
    c.items.forEach(it => {
      const row = card.querySelector(`.item-row[data-item-id="${cssEscape(it.id)}"]`);
      if (!row) return;
      const m = !q || it.name.toLowerCase().includes(q);
      row.classList.toggle('is-hidden-search', !m);
      if (m) vc++;
    });
    const empty = q && vc === 0;
    card.classList.toggle('is-empty-search', empty);
    if (!empty) any = true;
    if (q && vc > 0) card.classList.add('expanded');
    else if (!q) card.classList.toggle('expanded', !!expandedState[c.id]);
  });
  document.getElementById('emptyState').classList.toggle('show', q && !any);
}

const arModalOverlay = document.getElementById('adjustReasonModalOverlay');
const arList = document.getElementById('adjustReasonList');
const arConfirmBtn = document.getElementById('adjustReasonConfirm');
const arCancelBtn = document.getElementById('adjustReasonCancel');

function openAdjustReasonModal(updates) {
  pendingAdjustmentUpdates = updates;
  arList.innerHTML = '';
  updates.forEach(u => {
    const f = findItem(u.itemId);
    const name = f ? f.item.name : 'Item';
    const oldQty = f ? f.item.lastConfirmedQty : 0;
    const row = document.createElement('div');
    row.className = 'adjust-reason-row';
    row.dataset.itemId = u.itemId;
    const direction = u.quantity > oldQty ? 'increase' : 'decrease';
    const reasons = (appConfig.adjustmentReasons && appConfig.adjustmentReasons[direction]) || [];
    row.innerHTML = `
      <div class="adjust-reason-header">
        <span class="adjust-reason-name">${escapeHtml(name)}</span>
        <span class="adjust-reason-delta">${oldQty} → ${u.quantity}</span>
      </div>
      <select class="adjust-reason-select">
        <option value="">-- Select reason --</option>
        ${reasons.map(r => `<option value="${escapeHtml(r.value)}">${escapeHtml(r.label)}</option>`).join('')}
      </select>
      <textarea class="adjust-reason-note hidden" rows="2" placeholder="Reason note (required)"></textarea>
    `;
    const sel = row.querySelector('.adjust-reason-select');
    const note = row.querySelector('.adjust-reason-note');
    sel.addEventListener('change', () => {
      const isOther = sel.value && (sel.value.includes('other_') || sel.value === 'Other');
      note.classList.toggle('hidden', !isOther);
      if (!isOther) note.value = '';
      validateAdjustReasonForm();
    });
    note.addEventListener('input', validateAdjustReasonForm);
    arList.appendChild(row);
  });
  validateAdjustReasonForm();
  openModal(arModalOverlay);
}

function validateAdjustReasonForm() {
  const rows = arList.querySelectorAll('.adjust-reason-row');
  let allValid = rows.length > 0;
  rows.forEach(row => {
    const sel = row.querySelector('.adjust-reason-select');
    const note = row.querySelector('.adjust-reason-note');
    if (!sel.value) { allValid = false; return; }
    if ((sel.value && sel.value.includes('other_')) && !note.value.trim()) { allValid = false; }
  });
  arConfirmBtn.disabled = !allValid;
}

arCancelBtn.addEventListener('click', () => {
  closeModal(arModalOverlay);
  pendingAdjustmentUpdates = [];
});

      arConfirmBtn.addEventListener('click', async () => {
        const rows = arList.querySelectorAll('.adjust-reason-row');
        const payload = [];
        rows.forEach(row => {
          const itemId = row.dataset.itemId;
          const sel = row.querySelector('.adjust-reason-select');
          const note = row.querySelector('.adjust-reason-note');
          const u = pendingAdjustmentUpdates.find(x => x.itemId === itemId);
          if (u) payload.push({ itemId: u.itemId, quantity: u.quantity, reason: sel.value, note: (sel.value && sel.value.includes('other_')) ? note.value.trim() : '' });
        });
        arConfirmBtn.disabled = true; arConfirmBtn.textContent = 'Saving…';
        isSaving = true; svBtn.disabled = true; svBtn.classList.add('is-saving'); document.getElementById('saveBtnLabel').textContent = 'Saving…';
        try {
          await api.saveStock(payload);
          clearSessionCache(CACHE_KEYS.inventory);
          setOnline(true);
          closeModal(arModalOverlay);
          pendingAdjustmentUpdates = [];
          toast('Inventory adjustment saved.');
          await loadInventory();
        } catch (e) {
          setOnline(false);
          toast(e.message || 'Failed to save inventory.', true);
        } finally {
          arConfirmBtn.disabled = false; arConfirmBtn.textContent = 'Save Changes';
          isSaving = false; svBtn.disabled = false; svBtn.classList.remove('is-saving'); document.getElementById('saveBtnLabel').textContent = 'Save Changes';
        }
      });

function doSave() {
  if (isSaving) return;
  const u = dirtyUpdates();
  if (!u.length) return;
  openAdjustReasonModal(u);
}

svBtn.addEventListener('click', doSave);
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (isDirty) doSave();
  }
});
window.addEventListener('beforeunload', e => {
  if (isDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

document.getElementById('resetBtn').addEventListener('click', () => openModal(document.getElementById('resetModalOverlay')));
document.getElementById('resetCancel').addEventListener('click', () => closeModal(document.getElementById('resetModalOverlay')));
document.getElementById('resetConfirm').addEventListener('click', () => {
  state.categories.forEach(c => c.items.forEach(it => { it.qty = 0; }));
  render();
  closeModal(document.getElementById('resetModalOverlay'));
  toast('All quantities set to 0 — press Save Changes to apply.');
});

document.getElementById('exportBtn').addEventListener('click', async () => {
  try {
    const blob = await api.exportInventory();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inventory_export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Inventory exported.');
  } catch (e) {
    toast(e.message || 'Export failed', true);
  }
});

      async function loadInventory() {
        document.getElementById('loadingText').textContent = 'Loading inventory…';

        const cachedInventory = getSessionCache(CACHE_KEYS.inventory);
        if (cachedInventory) {
          state.categories = cachedInventory;
          render();
          document.getElementById('loadingScreen').classList.add('fade-out');
          applySearchFilter();
          updateDirty();
          setOnline(true);
          return;
        }

        if (loadCache()) { render(); document.getElementById('loadingScreen').classList.add('fade-out'); applySearchFilter(); updateDirty(); }
        try {
          const cats = await api.loadStock();
          const arr = (cats && Array.isArray(cats.categories)) ? cats.categories : (Array.isArray(cats) ? cats : []);
          state.categories = arr.map(c => ({ id: c.id, name: c.name, icon: c.icon || 'default', items: (c.items || []).map(it => ({ id: it.id, name: it.name, qty: Number(it.qty) || 0, custom: !!it.custom, unit: it.unit || undefined, volume: it.volume !== undefined ? it.volume : undefined, volumeUnit: it.volumeUnit || undefined, remainingVolume: it.remainingVolume, remainingVolumeUnit: it.remainingVolumeUnit || null, containerVolume: it.containerVolume, editable: it.editable, locked: it.locked, lastConfirmedQty: Number(it.qty) || 0 })) }));
          saveCache();
          setSessionCache(CACHE_KEYS.inventory, state.categories);
          render();
        } catch (e) {
          if (state.categories.length > 0) { toast('Could not refresh inventory. Using cached data.', true); }
          else {
            document.getElementById('statusTitle').textContent = 'Could not load stock data';
            document.getElementById('statusMsg').textContent = e.message || 'Something went wrong.';
            document.getElementById('statusScreen').classList.remove('hidden');
            document.getElementById('loadingScreen').classList.add('fade-out'); return;
          }
        }
        try { const r = localStorage.getItem(EXPANDED_KEY); expandedState = r ? JSON.parse(r) : {}; } catch (e) { expandedState = {}; }
        if (!Object.keys(expandedState).length && state.categories[0]) expandedState[state.categories[0].id] = true;
        setOnline(true); document.getElementById('loadingScreen').classList.add('fade-out');
      }

window.rootEl = rootEl;
window.render = render;
window.renderCat = renderCat;
window.renderItemRow = renderItemRow;
window.renderItemRowOrig = renderItemRowOrig;
window.updateOverview = updateOverview;
window.changeQty = changeQty;
window.updateItemRowUI = updateItemRowUI;
window.dirtyUpdates = dirtyUpdates;
window.isDirtyFn = isDirtyFn;
window.updateDirty = updateDirty;
window.revertAll = revertAll;
window.setActive = setActive;
window.clearActive = clearActive;
window.refreshItem = refreshItem;
window.refreshCat = refreshCat;
window.appendCat = appendCat;
window.removeCat = removeCat;
window.moveItem = moveItem;
window.appendItem = appendItem;
window.removeItem = removeItem;
window.applySearchFilter = applySearchFilter;
window.openAdjustReasonModal = openAdjustReasonModal;
window.validateAdjustReasonForm = validateAdjustReasonForm;
window.doSave = doSave;
window.loadInventory = loadInventory;