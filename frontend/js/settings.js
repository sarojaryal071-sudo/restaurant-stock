'use strict';

async function loadSettings() {
  try {
    const data = await api.getSettings();
    settingsData = (data && data.settings) ? data.settings : data;
    showSettingsMenu();
  } catch (e) {
    toast('Could not load settings.', true);
  }
}

function showSettingsMenu() {
  settingsSubPage = 'menu';
  const container = document.getElementById('settingsContainer');
  if (!container) return;
  container.innerHTML = '';

  const sections = [
    { key: 'inventoryConfig', title: 'Inventory Configuration', icon: '🗂️', desc: 'Categories, items, and purchase packages' },
    { key: 'inventory', title: 'Inventory Behaviour', icon: '📦', desc: 'Negative stock rules & warnings' },
    { key: 'sales', title: 'Sales', icon: '📊', desc: 'Import POS sales and view summary' },
    { key: 'staff', title: 'Staff Management', icon: '👥', desc: 'Manage staff accounts' },
    { key: 'permissions', title: 'Staff Permissions', icon: '🔐', desc: 'Control staff access' }
  ];

  sections.forEach(sec => {
    const card = document.createElement('div');
    card.className = 'settings-menu-card';
    card.innerHTML = `
      <button class="cat-header">
        <div class="settings-menu-icon">${sec.icon}</div>
        <div class="cat-title-wrap" style="flex:1; text-align:left;">
          <div class="cat-name">${escapeHtml(sec.title)}</div>
          <div class="settings-menu-desc">${escapeHtml(sec.desc)}</div>
        </div>
        <svg class="cat-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M9 18l6-6-6-6"/></svg>
      </button>
    `;
    card.querySelector('.cat-header').addEventListener('click', () => showSettingsDetail(sec.key));
    container.appendChild(card);
  });
}

function showSettingsDetail(sectionKey) {
  settingsSubPage = sectionKey;
  const container = document.getElementById('settingsContainer');
  if (!container) return;
  const titles = {
    inventoryConfig: 'Inventory Configuration',
    inventory: 'Inventory Behaviour',
    sales: 'Sales',
    staff: 'Staff Management',
    permissions: 'Staff Permissions'
  };
  const title = titles[sectionKey] || sectionKey;
  const descriptions = {
    inventoryConfig: 'Manage categories, items, and purchase packages.',
    inventory: 'Control how negative stock is handled and warned about.',
    sales: 'Import POS sales reports and view sales summary.',
    staff: 'Create and manage staff accounts and their active status.',
    permissions: 'Control what staff members are allowed to do.'
  };
  container.innerHTML = `
    <button class="btn btn-ghost btn-small" id="settingsBackBtn" style="margin-bottom:var(--space-3);">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path d="M15 18l-6-6 6-6"/></svg> Back
    </button>
    <div class="settings-detail-header">
      <div class="settings-detail-title">${escapeHtml(title)}</div>
      <div class="settings-detail-desc">${escapeHtml(descriptions[sectionKey] || '')}</div>
    </div>
    <div id="settingsDetailContent"></div>
  `;
  document.getElementById('settingsBackBtn').addEventListener('click', showSettingsMenu);

  if (sectionKey === 'inventoryConfig') {
    showInventoryConfigDetail();
  } else if (sectionKey === 'inventory') {
    showInventoryBehaviourDetail();
  } else if (sectionKey === 'sales') {
    showSalesDetail();
  } else if (sectionKey === 'staff') {
    showStaffManagementDetail();
  } else if (sectionKey === 'permissions') {
    showPermissionsDetail();
  }
}

async function showInventoryConfigDetail() {
  const content = document.getElementById('settingsDetailContent');
  if (!content) return;
  content.innerHTML = '<div class="loading-spinner" style="margin:2rem auto;"></div>';
  try {
    await loadPackagesIfNeeded();
  } catch (e) {
    content.innerHTML = `<div class="empty-state show"><div>Could not load package data. ${escapeHtml(e.message)}</div></div>`;
    return;
  }
  renderInventoryConfig();
}

function renderInventoryConfig() {
  const content = document.getElementById('settingsDetailContent');
  if (!content) return;
  let html = `<div class="staff-toolbar"><button class="btn btn-gold btn-small" id="icAddCategoryBtn">+ Add Category</button><button class="btn btn-ghost btn-small" id="icAddItemBtn">+ Add Item</button></div>`;
  if (!state.categories.length) {
    html += '<div class="empty-state show"><div>No categories yet.</div></div>';
  } else {
    state.categories.forEach(cat => {
      html += `<div class="settings-card" style="margin-bottom:var(--space-3);" data-cat-id="${cat.id}">
        <button class="settings-header ic-cat-header" type="button">
          <span class="section-title">${escapeHtml(cat.name)}</span>
          <span style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:0.72rem;color:var(--paper-faint);">${cat.items.length} item${cat.items.length === 1 ? '' : 's'}</span>
            <svg class="cat-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;width:18px;height:18px;"><path d="M6 9l6 6 6-6"/></svg>
          </span>
        </button>
        <div class="settings-body"><div style="padding-bottom:var(--space-2);">`;
      if (!cat.items.length) {
        html += `<div style="font-size:0.8rem;color:var(--paper-faint);padding:8px 0;">No items in this category.</div>`;
      } else {
        cat.items.forEach(it => {
          const volLabel = it.volume ? `${it.volume}${it.volumeUnit ? ' ' + it.volumeUnit : ''}` : '—';
          const pkgs = packagesForItem(it.id);
          html += `<div style="border-top:1px solid var(--line);padding:10px 0;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <div>
                <div style="font-weight:700;font-size:0.9rem;color:var(--paper);">${escapeHtml(it.name)}</div>
                <div style="font-size:0.72rem;color:var(--paper-faint);">Volume: ${escapeHtml(volLabel)} · Stock unit: ${escapeHtml(it.unit || '—')}</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button class="btn btn-ghost btn-small ic-edit-item-btn" data-item-id="${it.id}">Edit</button>
                <button class="btn btn-ghost btn-small ic-packages-btn" data-item-id="${it.id}">Packages</button>
              </div>
            </div>
            <div style="margin-top:6px;font-size:0.76rem;color:var(--paper-dim);">
              ${pkgs.length ? pkgs.map(p => `${escapeHtml(p.package_unit)} → ${p.units_per_package} ${escapeHtml(it.unit || 'units')}${p.enabled ? '' : ' (disabled)'}`).join(' · ') : 'No packages configured yet.'}
            </div>
          </div>`;
        });
      }
      html += `</div></div></div>`;
    });
  }
  content.innerHTML = html;

  content.querySelectorAll('.ic-cat-header').forEach(h => {
    h.addEventListener('click', () => { h.closest('.settings-card').classList.toggle('expanded'); });
  });
  const addCatBtn = document.getElementById('icAddCategoryBtn');
  if (addCatBtn) addCatBtn.addEventListener('click', () => openCatDialog('add'));
  const addItemBtn = document.getElementById('icAddItemBtn');
  if (addItemBtn) addItemBtn.addEventListener('click', () => {
    if (!state.categories.length) { toast('Add a category first.', true); return; }
    popCatSel();
    document.getElementById('newItemName').value = '';
    document.getElementById('newItemQty').value = 0;
    document.getElementById('newItemVolume').value = '';
    popStockUnitSel(document.getElementById('newItemUnit'));
    popVolumeUnitSel(document.getElementById('newItemVolumeUnit'));
    openModal(document.getElementById('addModalOverlay'));
  });
  content.querySelectorAll('.ic-edit-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = findItem(btn.dataset.itemId);
      if (f) openEditItem(f.item);
    });
  });
  content.querySelectorAll('.ic-packages-btn').forEach(btn => {
    btn.addEventListener('click', () => openPackageManager(btn.dataset.itemId));
  });
}

function showInventoryBehaviourDetail() {
  const content = document.getElementById('settingsDetailContent');
  if (!content) return;
  const ib = settingsData && settingsData.inventoryBehaviour ? settingsData.inventoryBehaviour : { negativeStockAllowed: false, showNegativeWarning: true };
  content.innerHTML = `
    <div class="toggle-row">
      <div class="toggle-row-text">
        <div class="toggle-row-title">Allow Negative Stock</div>
        <div class="toggle-row-desc">Lets item quantities go below zero when sales exceed available stock.</div>
      </div>
      <div class="toggle-3d">
        <input type="checkbox" id="ibNegativeStockAllowed" ${ib.negativeStockAllowed ? 'checked' : ''}>
        <label for="ibNegativeStockAllowed"><span class="thumb"></span></label>
        <div class="lights"><span class="light-off"></span><span class="light-on"></span></div>
      </div>
    </div>
    <div class="toggle-row">
      <div class="toggle-row-text">
        <div class="toggle-row-title">Show Negative Warning</div>
        <div class="toggle-row-desc">Displays an on-screen warning whenever an item's stock goes negative.</div>
      </div>
      <div class="toggle-3d">
        <input type="checkbox" id="ibShowNegativeWarning" ${ib.showNegativeWarning ? 'checked' : ''}>
        <label for="ibShowNegativeWarning"><span class="thumb"></span></label>
        <div class="lights"><span class="light-off"></span><span class="light-on"></span></div>
      </div>
    </div>
  `;
  const btn = document.createElement('button');
  btn.className = 'btn-save-premium';
  btn.textContent = 'Save Changes';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const payload = {
        negativeStockAllowed: document.getElementById('ibNegativeStockAllowed').checked,
        showNegativeWarning: document.getElementById('ibShowNegativeWarning').checked
      };
      await api.updateSettings('inventoryBehaviour', payload);
      toast('Inventory behaviour saved.');
    } catch (err) {
      toast(err.message || 'Save failed', true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  });
  content.appendChild(btn);
}

async function showPermissionsDetail() {
  try {
    const cachedPermissions = getSessionCache(CACHE_KEYS.permissions);
    const data = cachedPermissionsData || cachedPermissions || await api.getPermissions();
    if (cachedPermissions && !cachedPermissionsData) cachedPermissionsData = cachedPermissions;

    const definitions = data && data.definitions ? data.definitions : [];
    const perms = data && data.permissions ? data.permissions : { staff: {}, manager: {} };
    const staffPerms = perms.staff || {};
    const content = document.getElementById('settingsDetailContent');
    if (!content) return;
    content.innerHTML = '';

    const moduleMap = {};
    definitions.forEach(def => {
      if (!def.enabled) return;
      if (!moduleMap[def.module]) moduleMap[def.module] = [];
      moduleMap[def.module].push(def);
    });

    Object.keys(moduleMap).forEach(mod => {
      content.innerHTML += `<div class="permission-group"><div class="permission-group-title">${mod.charAt(0).toUpperCase() + mod.slice(1)}</div>`;
      moduleMap[mod].forEach(def => {
        const checked = staffPerms[def.module] && staffPerms[def.module][def.permission] === true;
        content.innerHTML += `
          <div class="permission-item">
            <span class="permission-item-label">${escapeHtml(def.label)}</span>
            <div class="toggle-3d">
              <input type="checkbox" ${checked ? 'checked' : ''} data-mod="${def.module}" data-perm="${def.permission}" id="perm-${def.module}-${def.permission}">
              <label for="perm-${def.module}-${def.permission}"><span class="thumb"></span></label>
              <div class="lights"><span class="light-off"></span><span class="light-on"></span></div>
            </div>
          </div>`;
      });
      content.innerHTML += `</div>`;
    });

    const btn = document.createElement('button');
    btn.className = 'btn-save-premium';
    btn.textContent = 'Save Permissions';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const fullStaff = {};
        definitions.forEach(def => {
          if (!def.enabled) return;
          if (!fullStaff[def.module]) fullStaff[def.module] = {};
          fullStaff[def.module][def.permission] = false;
        });
        content.querySelectorAll('input[data-mod]').forEach(cb => {
          const mod = cb.dataset.mod;
          const perm = cb.dataset.perm;
          if (fullStaff[mod]) fullStaff[mod][perm] = cb.checked;
        });
        await api.updatePermissions('staff', fullStaff);
        clearSessionCache(CACHE_KEYS.permissions);
        toast('Staff permissions updated.');
      } catch (err) {
        toast(err.message || 'Failed to save permissions', true);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save Permissions';
      }
    });
    content.appendChild(btn);
  } catch (e) {
    toast('Could not load permissions.', true);
  }
}

let editingStaffId = null;

async function showStaffManagementDetail() {
  const content = document.getElementById('settingsDetailContent');
  if (!content) return;
  if (!can('staff', 'view')) {
    content.innerHTML = '<div class="empty-state show"><div>You do not have permission to manage staff.</div></div>';
    return;
  }

  const cached = getSessionCache(CACHE_KEYS.staff) || cachedStaffData;
  if (cached) {
    cachedStaffData = cached;
    renderStaffList(cached);
    return;
  }

  content.innerHTML = '<div class="loading-spinner" style="margin:2rem auto;"></div>';
  try {
    const data = await api.listStaff();
    const staff = data.staff || [];
    cachedStaffData = staff;
    setSessionCache(CACHE_KEYS.staff, staff);
    renderStaffList(staff);
  } catch (e) {
    content.innerHTML = `<div class="empty-state show"><div>Could not load staff list. ${escapeHtml(e.message)}</div></div>`;
  }
}

function renderStaffList(staffArray) {
  const content = document.getElementById('settingsDetailContent');
  if (!content) return;
  const canCreate = can('staff', 'create');
  const canEdit = can('staff', 'edit');
  let html = '';
  if (canCreate) {
    html += `<div class="staff-toolbar"><button class="btn btn-gold btn-small" id="addStaffBtn">+ Add Staff</button></div>`;
  }
  if (!staffArray || staffArray.length === 0) {
    html += '<div class="empty-state show"><div>No staff members yet.</div></div>';
  } else {
    html += `<table class="staff-table"><thead><tr><th>Name</th><th>Username</th><th>Status</th><th>Created</th>${canEdit ? '<th></th>' : ''}</tr></thead><tbody>`;
    staffArray.forEach(s => {
      const created = s.created_at ? new Date(s.created_at).toLocaleDateString() : '—';
      const statusBadge = s.is_active ? '<span class="badge-active">Active</span>' : '<span class="badge-inactive">Inactive</span>';
      const initial = escapeHtml((s.name || '?').trim().charAt(0).toUpperCase());
      html += `<tr>
        <td data-label="Name"><span class="staff-name-cell"><span class="staff-avatar">${initial}</span>${escapeHtml(s.name)}</span></td>
        <td data-label="Username">${escapeHtml(s.username || '—')}</td>
        <td data-label="Status">${statusBadge}</td>
        <td data-label="Created">${created}</td>
        ${canEdit ? `<td data-label=""><button class="btn btn-ghost btn-small edit-staff-btn" data-id="${s.id}" data-name="${escapeHtml(s.name)}" data-active="${s.is_active}">Edit</button></td>` : ''}
      </tr>`;
    });
    html += '</tbody></table>';
  }
  content.innerHTML = html;

  if (canCreate) {
    document.getElementById('addStaffBtn').addEventListener('click', () => openStaffAddModal());
  }
  if (canEdit) {
    content.querySelectorAll('.edit-staff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        openStaffEditModal(btn.dataset.id, btn.dataset.name, btn.dataset.active === 'true');
      });
    });
  }
}

function openStaffAddModal() {
  document.getElementById('staffAddName').value = '';
  document.getElementById('staffAddPin').value = '';
  openModal(document.getElementById('staffAddModalOverlay'));
  setTimeout(() => document.getElementById('staffAddName').focus(), 250);
}

function openStaffEditModal(id, name, active) {
  editingStaffId = id;
  document.getElementById('staffEditName').value = name;
  document.getElementById('staffEditPin').value = '';
  document.getElementById('staffEditActive').checked = active;
  openModal(document.getElementById('staffEditModalOverlay'));
  setTimeout(() => document.getElementById('staffEditName').focus(), 250);
}

document.getElementById('staffAddCancel').addEventListener('click', () => {
  closeModal(document.getElementById('staffAddModalOverlay'));
});
document.getElementById('staffAddConfirm').addEventListener('click', async () => {
  const name = document.getElementById('staffAddName').value.trim();
  const pin = document.getElementById('staffAddPin').value.trim();
  if (!name) { toast('Name is required.', true); return; }
  if (!pin || !/^\d{4,6}$/.test(pin)) { toast('PIN must be 4-6 digits.', true); return; }
  const btn = document.getElementById('staffAddConfirm');
  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
        await api.createStaff(name, pin);
        clearSessionCache(CACHE_KEYS.staff);
        toast('Staff created.');
        closeModal(document.getElementById('staffAddModalOverlay'));
        cachedStaffData = null;
        showStaffManagementDetail();
  } catch (e) {
    toast(e.message || 'Failed to create staff.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create';
  }
});

document.getElementById('staffEditCancel').addEventListener('click', () => {
  closeModal(document.getElementById('staffEditModalOverlay'));
  editingStaffId = null;
});
document.getElementById('staffEditConfirm').addEventListener('click', async () => {
  if (!editingStaffId) return;
  const name = document.getElementById('staffEditName').value.trim();
  const pin = document.getElementById('staffEditPin').value.trim();
  const isActive = document.getElementById('staffEditActive').checked;
  if (!name) { toast('Name is required.', true); return; }
  if (pin && !/^\d{4,6}$/.test(pin)) { toast('PIN must be 4-6 digits.', true); return; }
  const payload = { name, is_active: isActive };
  if (pin) payload.pin = pin;
  const btn = document.getElementById('staffEditConfirm');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
        await api.updateStaff(editingStaffId, payload);
        clearSessionCache(CACHE_KEYS.staff);
        toast('Staff updated.');
        closeModal(document.getElementById('staffEditModalOverlay'));
        editingStaffId = null;
        cachedStaffData = null;
        showStaffManagementDetail();
  } catch (e) {
    toast(e.message || 'Failed to update staff.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
});

window.loadSettings = loadSettings;
window.showSettingsMenu = showSettingsMenu;
window.showSettingsDetail = showSettingsDetail;
window.showInventoryConfigDetail = showInventoryConfigDetail;
window.renderInventoryConfig = renderInventoryConfig;
window.showInventoryBehaviourDetail = showInventoryBehaviourDetail;
window.showPermissionsDetail = showPermissionsDetail;
window.showStaffManagementDetail = showStaffManagementDetail;
window.renderStaffList = renderStaffList;
window.openStaffAddModal = openStaffAddModal;
window.openStaffEditModal = openStaffEditModal;