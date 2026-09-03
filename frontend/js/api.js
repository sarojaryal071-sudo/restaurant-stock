'use strict';

async function apiCall(method, path, body = null, responseType = 'json') {
  if (!API_BASE) throw new Error('API_BASE is not configured.');
  let url = API_BASE + path;
  if (authToken) {
    url += (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(authToken);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  const opts = { method, signal: ctrl.signal, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    if (authToken) body.token = authToken;
    opts.body = JSON.stringify(body);
  } else if (method === 'POST' && authToken) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify({ token: authToken });
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    clearTimeout(t);
    if (e.name === 'AbortError') throw new Error('Request timed out');
    throw new Error('Network error — unable to reach server.');
  }
  clearTimeout(t);
  if (res.status === 401 || res.status === 403) {
    clearAuth();
    showLogin();
    throw new Error('Session expired. Please log in again.');
  }
  if (!res.ok) throw new Error('Server error (HTTP ' + res.status + ')');
  if (responseType === 'blob') return await res.blob();
  if (responseType === 'text') return await res.text();
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('Unexpected response from server.'); }
  if (data && data.ok === false) {
    if (data.code === 'UNAUTHORIZED') {
      clearAuth();
      showLogin();
      throw new Error(data.error || 'Session expired.');
    }
    const e = new Error(data.error || 'Request failed');
    e.code = data.code || null;
    throw e;
  }
  return data && data.data !== undefined ? data.data : data;
}

async function apiUpload(path, formData) {
  if (!API_BASE) throw new Error('API_BASE is not configured.');
  let url = API_BASE + path;
  if (authToken) {
    url += (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(authToken);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'POST', signal: ctrl.signal, body: formData });
    clearTimeout(t);
    if (res.status === 401 || res.status === 403) {
      clearAuth();
      showLogin();
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) throw new Error('Server error (HTTP ' + res.status + ')');
    let data = await res.json();
    if (data && data.ok === false) {
      if (data.code === 'UNAUTHORIZED') {
        clearAuth();
        showLogin();
        throw new Error(data.error || 'Session expired.');
      }
      const e = new Error(data.error || 'Request failed');
      e.code = data.code || null;
      throw e;
    }
    return data && data.data !== undefined ? data.data : data;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

const api = {
  health: () => apiCall('GET', '/health'),
  login: (username, pin) => apiCall('POST', '/login', { username, pin }),
  logout: () => apiCall('POST', '/logout', {}),
  loadStock: () => apiCall('GET', '/?action=loadStock'),
  saveStock: (updates) => apiCall('POST', '/', { action: 'saveStock', updates }),
  addCustomItem: (categoryId, name, quantity, extra) => apiCall('POST', '/', { action: 'addCustomItem', categoryId, name, quantity, ...(extra || {}) }),
  updateItem: (itemId, data) => apiCall('POST', '/', { action: 'updateItem', itemId, ...data }),
  deleteItem: (itemId) => apiCall('POST', '/', { action: 'deleteItem', itemId }),
  restoreItem: (itemId) => apiCall('POST', '/', { action: 'restoreItem', itemId }),
  addCategory: (name) => apiCall('POST', '/', { action: 'addCategory', name }),
  updateCategory: (categoryId, name) => apiCall('POST', '/', { action: 'updateCategory', categoryId, name }),
  deleteCategory: (categoryId) => apiCall('POST', '/', { action: 'deleteCategory', categoryId }),
  restoreCategory: (categoryId) => apiCall('POST', '/', { action: 'restoreCategory', categoryId }),
  listRecipes: () => apiCall('GET', '/?action=listRecipes'),
  getRecipe: (recipeId) => apiCall('GET', '/?action=getRecipe&recipeId=' + encodeURIComponent(recipeId)),
  createRecipe: (data) => apiCall('POST', '/', { action: 'createRecipe', ...data }),
  updateRecipe: (recipeId, data) => apiCall('POST', '/', { action: 'updateRecipe', recipeId, ...data }),
  deleteRecipe: (recipeId) => apiCall('POST', '/', { action: 'deleteRecipe', recipeId }),
  recordSale: (recipeId, quantity) => apiCall('POST', '/', { action: 'recordSale', recipeId, quantity }),
  getConfig: () => apiCall('GET', '/?action=getConfig'),
  getInventoryConfig: () => apiCall('GET', '/config'),
  exportInventory: () => apiCall('GET', '/?action=exportInventory', null, 'blob'),
  resetStock: () => apiCall('POST', '/', { action: 'resetStock' }),
  getSettings: () => apiCall('GET', '/settings'),
  updateSettings: (section, data) => apiCall('PATCH', `/settings/${section}`, data),
  getPermissions: () => apiCall('GET', '/permissions'),
  updatePermissions: (role, permissions) => apiCall('PATCH', '/permissions', { role, permissions }),
  connectPos: (provider) => apiCall('POST', '/pos/connect', { provider }),
  disconnectPos: () => apiCall('POST', '/pos/disconnect'),
  syncPos: () => apiCall('POST', '/pos/sync'),
  getPosSales: (period, start, end) => {
    let q = '/pos/sales?period=' + encodeURIComponent(period || 'today');
    if (period === 'custom' && start && end) {
      q += '&start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end);
    }
    return apiCall('GET', q);
  },
  getStockIntake: (start, end) => {
    let q = '/stock-intake';
    const params = [];
    if (start) params.push('start=' + encodeURIComponent(start));
    if (end) params.push('end=' + encodeURIComponent(end));
    if (params.length) q += '?' + params.join('&');
    return apiCall('GET', q);
  },
  createStockIntake: (items, purchaseDate) => apiCall('POST', '/stock-intake', purchaseDate ? { items, purchaseDate } : { items }),
  previewStockIntake: (itemId, packageId, quantityPurchased) => apiCall('POST', '/stock-intake/preview', { itemId, packageId, quantityPurchased }),
  updateStockIntake: (id, items, purchaseDate) => apiCall('PATCH', `/stock-intake/${id}`, purchaseDate ? { items, purchaseDate } : { items }),
  cancelStockIntake: (id) => apiCall('POST', `/stock-intake/${id}/cancel`, {}),
  getPackages: () => apiCall('GET', '/packages'),
  createPackage: (itemId, packageUnit, unitsPerPackage, sortOrder) => apiCall('POST', '/packages', { itemId, packageUnit, unitsPerPackage, sortOrder }),
  updatePackage: (id, data) => apiCall('PATCH', `/packages/${id}`, data),
  deletePackage: (id) => apiCall('DELETE', `/packages/${id}`),
  listPendingAllocations: () => apiCall('GET', '/?action=listPendingAllocations'),
  getPendingAllocationDetails: (allocationId) => apiCall('GET', '/?action=getPendingAllocationDetails&allocationId=' + encodeURIComponent(allocationId)),
  resolvePendingAllocation: (allocationId, mappings) => apiCall('POST', '/', { action: 'resolvePendingAllocation', allocationId, mappings }),
  listStaff: () => apiCall('GET', '/staff'),
  createStaff: (name, pin) => apiCall('POST', '/staff', { name, pin }),
  updateStaff: (id, data) => apiCall('PATCH', `/staff/${id}`, data),
        getSalesSummary: (period) => apiCall('GET', '/pos/sales?period=' + encodeURIComponent(period)),
        saveSalesMapping: (sourceProductName, itemId, recipeId, extra) => {
          const payload = { sourceProductName };
          if (itemId) payload.itemId = itemId;
          if (recipeId) payload.recipeId = recipeId;
          if (extra && extra.unit) payload.unit = extra.unit;
          if (extra && extra.servingName) payload.servingName = extra.servingName;
          if (extra && extra.salesVolume != null && extra.salesVolume !== '') payload.salesVolume = extra.salesVolume;
          if (extra && extra.salesVolumeUnit) payload.salesVolumeUnit = extra.salesVolumeUnit;
          return apiCall('POST', '/pos/sales/mappings', payload);
        },
        getSalesServingNames: () => apiCall('GET', '/pos/sales/serving-names'),
        applySalesImport: (fileHash, periodStart, periodEnd, items) => apiCall('POST', '/pos/sales/import/apply', { fileHash, periodStart, periodEnd, items }),
        getSalesImportHistory: () => apiCall('GET', '/pos/sales/import/history'),
        cancelSalesImport: (id) => apiCall('POST', `/pos/sales/import/${id}/cancel`, {})};

window.apiCall = apiCall;
window.apiUpload = apiUpload;
window.api = api;