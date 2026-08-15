'use strict';

async function loadPackagesIfNeeded() {
  if (cachedPackagesData) return cachedPackagesData;
  const data = await api.getPackages();
  cachedPackagesData = (data && Array.isArray(data.packages)) ? data.packages : [];
  return cachedPackagesData;
}

function packagesForItem(itemId) {
  return (cachedPackagesData || []).filter(p => p.item_id === itemId);
}

function renderEditItemPackageSummary(itemId) {
  const list = document.getElementById('editItemPackagesList');
  if (!list) return;
  const f = findItem(itemId);
  const stockUnit = f ? (f.item.unit || 'units') : 'units';
  const pkgs = packagesForItem(itemId);
  if (!pkgs.length) {
    list.innerHTML = '<div class="package-readonly-empty">No packages configured</div>';
    return;
  }
  list.innerHTML = pkgs.map(p => {
    const num = parseFloat(p.units_per_package);
    const status = p.enabled ? '' : ' <span class="package-readonly-status">Disabled</span>';
    return `<div class="package-readonly-row">
      <div class="package-readonly-unit">${escapeHtml(p.package_unit)}</div>
      <div class="package-readonly-qty">${num} ${escapeHtml(stockUnit)}${num === 1 ? '' : 's'}${status}</div>
    </div>`;
  }).join('');
}

function openPackageManager(itemId) {
  managingPackagesForItemId = itemId;
  editingPackageId = null;
  const f = findItem(itemId);
  document.getElementById('packageManagerTitle').textContent = f ? `Packages — ${f.item.name}` : 'Packages';
  document.getElementById('packageUnitInput').value = '';
  document.getElementById('packageUnitsPerInput').value = '';
  const addBtn = document.getElementById('packageAddBtn');
  if (addBtn) {
    addBtn.textContent = 'Add Package';
    addBtn.classList.remove('btn-ghost');
    addBtn.classList.add('btn-gold');
  }
  renderPackageManagerList();
  openModal(document.getElementById('packageManagerModalOverlay'));
}

function renderPackageManagerList() {
  const list = document.getElementById('packageManagerList');
  if (!list) return;
  const f = findItem(managingPackagesForItemId);
  const stockUnit = f ? (f.item.unit || 'units') : 'units';
  const pkgs = packagesForItem(managingPackagesForItemId);
  if (!pkgs.length) {
    list.innerHTML = '<div style="font-size:0.82rem;color:var(--paper-faint);padding:8px 0;">No packages yet. Add one below.</div>';
  } else {
    list.innerHTML = pkgs.map(p => `
      <div class="adjust-reason-row" data-package-id="${p.id}">
        <div class="adjust-reason-header">
          <span class="adjust-reason-name">${escapeHtml(p.package_unit)} → ${p.units_per_package} ${escapeHtml(stockUnit)}</span>
          <span style="font-size:0.72rem;color:${p.enabled ? 'var(--qty-good)' : 'var(--paper-faint)'};">${p.enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-small pkg-edit-btn" data-package-id="${p.id}" data-unit="${escapeHtml(p.package_unit)}" data-units="${p.units_per_package}">Edit</button>
          <button class="btn btn-ghost btn-small pkg-toggle-btn" data-package-id="${p.id}" data-enabled="${p.enabled}">${p.enabled ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-danger btn-small pkg-delete-btn" data-package-id="${p.id}">Delete</button>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.pkg-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        editingPackageId = btn.dataset.packageId;
        document.getElementById('packageUnitInput').value = btn.dataset.unit;
        document.getElementById('packageUnitsPerInput').value = btn.dataset.units;
        const addBtn = document.getElementById('packageAddBtn');
        if (addBtn) {
          addBtn.textContent = 'Update Package';
          addBtn.classList.remove('btn-gold');
          addBtn.classList.add('btn-ghost');
        }
      });
    });
    list.querySelectorAll('.pkg-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await api.updatePackage(btn.dataset.packageId, { enabled: btn.dataset.enabled !== 'true' });
          cachedPackagesData = null;
          await loadPackagesIfNeeded();
          renderPackageManagerList();
          renderInventoryConfig();
          if (editingItemId) renderEditItemPackageSummary(editingItemId);
        } catch (e) {
          toast(e.message || 'Failed to update package', true);
        } finally {
          btn.disabled = false;
        }
      });
    });
    list.querySelectorAll('.pkg-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await api.deletePackage(btn.dataset.packageId);
          cachedPackagesData = null;
          await loadPackagesIfNeeded();
          renderPackageManagerList();
          renderInventoryConfig();
          if (editingItemId) renderEditItemPackageSummary(editingItemId);
          toast('Package deleted.');
        } catch (e) {
          toast(e.message || 'Failed to delete package', true);
          btn.disabled = false;
        }
      });
    });
  }
  if (editingItemId) renderEditItemPackageSummary(editingItemId);
}

document.getElementById('packageAddBtn').addEventListener('click', async () => {
  const unitInput = document.getElementById('packageUnitInput');
  const perPackageInput = document.getElementById('packageUnitsPerInput');
  const unitVal = unitInput.value.trim();
  const perPackage = parseFloat(perPackageInput.value);
  if (!unitVal) { toast('Enter a purchase unit name (e.g. Case).', true); return; }
  if (!perPackage || perPackage <= 0) { toast('Enter how many stock units this package contains.', true); return; }
  const btn = document.getElementById('packageAddBtn');
  btn.disabled = true;
  try {
    if (editingPackageId) {
      await api.updatePackage(editingPackageId, { package_unit: unitVal, units_per_package: perPackage });
      toast('Package updated.');
      editingPackageId = null;
    } else {
      await api.createPackage(managingPackagesForItemId, unitVal, perPackage, 0);
      toast('Package added.');
    }
    cachedPackagesData = null;
    await loadPackagesIfNeeded();
    unitInput.value = '';
    perPackageInput.value = '';
    btn.textContent = 'Add Package';
    btn.classList.remove('btn-ghost');
    btn.classList.add('btn-gold');
    renderPackageManagerList();
    renderInventoryConfig();
  } catch (e) {
    toast(e.message || 'Failed to save package', true);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('packageManagerCloseBtn').addEventListener('click', () => {
  closeModal(document.getElementById('packageManagerModalOverlay'));
});

window.loadPackagesIfNeeded = loadPackagesIfNeeded;
window.packagesForItem = packagesForItem;
window.renderEditItemPackageSummary = renderEditItemPackageSummary;
window.openPackageManager = openPackageManager;
window.renderPackageManagerList = renderPackageManagerList;