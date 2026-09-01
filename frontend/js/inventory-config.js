'use strict';

const eio = document.getElementById('editItemOverlay');
const ein = document.getElementById('editItemName');
const eic = document.getElementById('editItemCategory');
const eiu = document.getElementById('editItemUnit');
const eicf = document.getElementById('editItemConfirm');
const eiVol = document.getElementById('editItemVolume'), eiVolUnit = document.getElementById('editItemVolumeUnit');
const eiSalesVol = document.getElementById('editItemSalesVolume'), eiSalesVolUnit = document.getElementById('editItemSalesVolumeUnit');

function popEditCat(sel) {
  eic.innerHTML = '';
  state.categories.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    if (c.id === sel) o.selected = true;
    eic.appendChild(o);
  });
}

async function openEditItem(it) {
  editingItemId = it.id;
  ein.value = it.name;
  const f = findItem(it.id);
  popEditCat(f ? f.cat.id : '');
  eiu.innerHTML = '<option value="">--</option>';
  (appConfig.units || []).forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.value;
    opt.textContent = u.label;
    if (u.value === (it.unit || '')) opt.selected = true;
    eiu.appendChild(opt);
  });
        eiVol.value = it.volume !== undefined ? it.volume : '';
        eiVolUnit.innerHTML = '<option value="">--</option>';
        (appConfig.units || []).filter(u => ['ml', 'cl', 'L'].includes(u.value)).forEach(u => {
          const opt = document.createElement('option');
          opt.value = u.value;
          opt.textContent = u.label;
          if (u.value === (it.volumeUnit || '')) opt.selected = true;
          eiVolUnit.appendChild(opt);
        });

        eiSalesVol.value = it.salesVolume !== undefined && it.salesVolume !== null ? it.salesVolume : '';
        popSalesVolumeUnitSel(eiSalesVolUnit);
        // If this item's existing sales-volume unit predates the ml/cl/L
        // filter, keep it selectable rather than silently dropping it —
        // saving the form without touching this field must never change
        // a value the user didn't ask to change.
        if (it.salesVolumeUnit && !Array.from(eiSalesVolUnit.options).some(o => o.value === it.salesVolumeUnit)) {
          const extra = document.createElement('option');
          extra.value = it.salesVolumeUnit;
          extra.textContent = it.salesVolumeUnit;
          eiSalesVolUnit.appendChild(extra);
        }
        eiSalesVolUnit.value = it.salesVolumeUnit || '';
  try { await loadPackagesIfNeeded(); } catch (e) { }
  renderEditItemPackageSummary(it.id);
  syncServingVisibility();
  openModal(eio);
  setTimeout(() => ein.focus(), 250);
}

document.getElementById('editItemCancel').addEventListener('click', () => {
  closeModal(eio);
  editingItemId = null;
});

document.getElementById('editItemPackagesBtn').addEventListener('click', () => {
  if (!editingItemId) return;
  openPackageManager(editingItemId);
});

eicf.addEventListener('click', async () => {
  if (!editingItemId) return;
  const name = ein.value.trim();
  if (!name) { ein.focus(); return; }
  const cid = eic.value;
  const unit = eiu.value || undefined;
        const volRaw = eiVol.value;
        const vol = volRaw ? parseFloat(volRaw) : undefined;
        const volUnit = eiVolUnit.value || undefined;
        const salesVolRaw = eiSalesVol.value;
        const salesVol = salesVolRaw ? parseFloat(salesVolRaw) : null;
        const salesVolUnit = salesVol ? (eiSalesVolUnit.value || null) : null;
  if (vol !== undefined && (isNaN(vol) || vol <= 0)) {
    toast('Volume must be greater than 0.', true);
    return;
  }
  if (vol !== undefined && !volUnit) {
    toast('Select a volume unit.', true);
    return;
  }
  const f = findItem(editingItemId);
  if (!f) return;
  const { item, cat } = f;
  const oid = cat.id;
  eicf.disabled = true;
  eicf.textContent = 'Saving…';
  try {
          await api.updateItem(editingItemId, { name, categoryId: cid, unit, volume: vol, volumeUnit: volUnit, salesVolume: salesVol, salesVolumeUnit: salesVolUnit });
          item.name = name;
          item.unit = unit;
          item.volume = vol;
          item.volumeUnit = volUnit;
          item.salesVolume = salesVol;
          item.salesVolumeUnit = salesVolUnit;
    if (cid !== oid) moveItem(editingItemId, oid, cid);
    else refreshItem(editingItemId);
    updateOverview();
    updateDirty();
    closeModal(eio);
    editingItemId = null;
    toast('Item updated.');
    if (settingsSubPage === 'inventoryConfig') renderInventoryConfig();
  } catch (e) {
    toast(e.message || 'Failed to update item', true);
  } finally {
    eicf.disabled = false;
    eicf.textContent = 'Save Changes';
  }
});

function delItem(it) {
  openConfirm('Delete Item', 'Delete "<b>' + escapeHtml(it.name) + '</b>"?<br>This will permanently delete the item.', async () => {
    try {
      await api.deleteItem(it.id);
      removeItem(it.id);
      toast('Item deleted.');
    } catch (e) {
      toast(e.message || 'Failed to delete item', true);
    }
  }, 'Delete');
}

const cdo = document.getElementById('categoryDialogOverlay');
const cdt = document.getElementById('categoryDialogTitle');
const cdn = document.getElementById('categoryDialogName');
const cdc = document.getElementById('categoryDialogConfirm');

function openCatDialog(mode, cat = null) {
  editingCategoryId = mode === 'rename' && cat ? cat.id : null;
  cdt.textContent = mode === 'rename' ? 'Rename Category' : 'Add Category';
  cdn.value = mode === 'rename' && cat ? cat.name : '';
  cdc.textContent = mode === 'rename' ? 'Save' : 'Add Category';
  openModal(cdo);
  setTimeout(() => cdn.focus(), 250);
}

document.getElementById('categoryDialogCancel').addEventListener('click', () => {
  closeModal(cdo);
  editingCategoryId = null;
});

cdc.addEventListener('click', async () => {
  const name = cdn.value.trim();
  if (!name) { cdn.focus(); return; }
  cdc.disabled = true;
  cdc.textContent = 'Saving…';
  try {
    if (editingCategoryId) {
      await api.updateCategory(editingCategoryId, name);
      const c = findCat(editingCategoryId);
      if (c) {
        c.name = name;
        const card = document.querySelector(`.cat-card[data-cat-id="${cssEscape(editingCategoryId)}"]`);
        if (card) {
          const ne = card.querySelector('.cat-name');
          if (ne) ne.textContent = name;
        }
        updateCatSelects();
      }
      toast('Category renamed.');
    } else {
      const r = await api.addCategory(name);
      const nc = { id: (r && r.category && r.category.id) ? r.category.id : uid(), name, icon: 'default', items: [] };
      state.categories.push(nc);
      appendCat(nc);
      toast('Category added.');
    }
    closeModal(cdo);
    editingCategoryId = null;
  } catch (e) {
    toast(e.message || 'Operation failed', true);
  } finally {
    cdc.disabled = false;
    cdc.textContent = editingCategoryId ? 'Save' : 'Add Category';
  }
});

function updateCatSelects() {
  popCatSel();
  const cv = document.getElementById('editItemCategory').value;
  popEditCat(cv);
}

function delCat(c) {
  openConfirm('Delete Category', 'Delete "<b>' + escapeHtml(c.name) + '</b>"?<br>This will permanently delete the category and all its items.', async () => {
    try {
      await api.deleteCategory(c.id);
      const idx = state.categories.findIndex(x => x.id === c.id);
      if (idx !== -1) state.categories.splice(idx, 1);
      removeCat(c.id);
      toast('Category deleted.');
    } catch (e) {
      toast(e.message || 'Failed to delete category', true);
    }
  }, 'Delete');
}

const aso = document.getElementById('actionSheetOverlay');
document.getElementById('actionSheetCancel').addEventListener('click', () => closeModal(aso));

const ao = document.getElementById('addModalOverlay');
const cs = document.getElementById('newItemCategory');
const nin = document.getElementById('newItemName');
const niq = document.getElementById('newItemQty');
const acf = document.getElementById('addModalConfirm');
const niUnit = document.getElementById('newItemUnit'), niVol = document.getElementById('newItemVolume'), niVolUnit = document.getElementById('newItemVolumeUnit');
const niSalesVol = document.getElementById('newItemSalesVolume'), niSalesVolUnit = document.getElementById('newItemSalesVolumeUnit');

function popCatSel() {
  cs.innerHTML = '';
  state.categories.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    cs.appendChild(o);
  });
}

function popStockUnitSel(selectEl) {
  selectEl.innerHTML = '<option value="">--</option>';
  (appConfig.units || []).forEach(u => {
    const o = document.createElement('option');
    o.value = u.value;
    o.textContent = u.label;
    selectEl.appendChild(o);
  });
}

      function popVolumeUnitSel(selectEl) { selectEl.innerHTML = '<option value="">--</option>'; (appConfig.units || []).filter(u => ['ml', 'cl', 'L'].includes(u.value)).forEach(u => { const o = document.createElement('option'); o.value = u.value; o.textContent = u.label; selectEl.appendChild(o); }); }
      function popSalesVolumeUnitSel(selectEl) { selectEl.innerHTML = '<option value="">--</option>'; (appConfig.units || []).filter(u => ['ml', 'cl', 'L'].includes(u.value)).forEach(u => { const o = document.createElement('option'); o.value = u.value; o.textContent = u.label; selectEl.appendChild(o); }); }

      // Progressive disclosure: the "Default serving size" group only
      // becomes relevant once a physical Volume has been set — matches
      // the same rule for both the Edit Item and Add Custom Item modals.
      function syncServingVisibility() {
        const eiGroup = document.getElementById('editItemServingGroup');
        if (eiGroup) eiGroup.classList.toggle('hidden', !(eiVol.value !== '' && parseFloat(eiVol.value) > 0));
        const niGroup = document.getElementById('newItemServingGroup');
        if (niGroup) niGroup.classList.toggle('hidden', !(niVol.value !== '' && parseFloat(niVol.value) > 0));
      }
      eiVol.addEventListener('input', syncServingVisibility);
      niVol.addEventListener('input', syncServingVisibility);

document.getElementById('addModalCancel').addEventListener('click', () => closeModal(ao));

acf.addEventListener('click', async () => {
  const name = nin.value.trim();
  if (!name) { nin.focus(); return; }
  let q = parseInt(niq.value, 10);
  if (isNaN(q) || q < 0) q = 0;
  const cid = cs.value;
  const c = state.categories.find(x => x.id === cid);
  if (!c) return;
  const unit = niUnit.value || undefined;
  const vol = niVol.value ? parseFloat(niVol.value) : undefined;
  const volUnit = niVolUnit.value || undefined;
  const salesVolRaw = niSalesVol.value;
  const salesVol = salesVolRaw ? parseFloat(salesVolRaw) : null;
  const salesVolUnit = salesVol ? (niSalesVolUnit.value || null) : null;
  acf.disabled = true;
  acf.textContent = 'Adding…';
  try {
    const r = await api.addCustomItem(cid, name, q, { unit, volume: vol, volumeUnit: volUnit, salesVolume: salesVol, salesVolumeUnit: salesVolUnit });
    const ni = (r && r.item) ? r.item : { id: uid(), name, q, custom: true };
    ni.custom = true;
    ni.lastConfirmedQty = ni.qty;
    ni.unit = unit;
    ni.volume = vol;
    ni.volumeUnit = volUnit;
    ni.salesVolume = salesVol;
    ni.salesVolumeUnit = salesVolUnit;
    appendItem(cid, ni);
    closeModal(ao);
    toast('Added "' + name + '"');
    if (settingsSubPage === 'inventoryConfig') renderInventoryConfig();
    openPackageManager(ni.id);
  } catch (e) {
    toast(e.message || 'Could not add item', true);
  } finally {
    acf.disabled = false;
    acf.textContent = 'Add Item';
  }
});

window.openEditItem = openEditItem;
window.delItem = delItem;
window.openCatDialog = openCatDialog;
window.delCat = delCat;
window.popCatSel = popCatSel;
window.popStockUnitSel = popStockUnitSel;
window.popVolumeUnitSel = popVolumeUnitSel;
window.popSalesVolumeUnitSel = popSalesVolumeUnitSel;
window.syncServingVisibility = syncServingVisibility;
window.updateCatSelects = updateCatSelects;