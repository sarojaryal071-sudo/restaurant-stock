'use strict';

const authSc = document.getElementById('authScreen');
const appEl = document.getElementById('app');
const usernameEl = document.getElementById('usernameInput');
const pinEl = document.getElementById('pinInput');
const loginBtn = document.getElementById('loginBtn');
const authErr = document.getElementById('authError');

function showLogin() {
  appEl.classList.add('hidden');
  authSc.classList.remove('hidden');
  document.getElementById('loadingScreen').classList.add('fade-out');
  document.getElementById('authRestaurantName').textContent = 'Stock Counter';
  document.getElementById('authLogoImg').src = GENERIC_LOGO;
  document.getElementById('brandSub').textContent = 'Stock Counter';
  hideAuthLoading();
  usernameEl.value = '';
  pinEl.value = '';
  authErr.textContent = '';
  usernameEl.focus();
}

function showApp() {
  authSc.classList.add('hidden');
  appEl.classList.remove('hidden');
  document.getElementById('loadingScreen').classList.add('fade-out');
  applyUIPermissions();
}

function showAuthLoading() {
  document.querySelector('#authScreen .auth-form').classList.add('hidden');
  const subtitle = document.querySelector('#authScreen .auth-subtitle');
  if (subtitle) subtitle.classList.add('hidden');
  const ls = document.getElementById('authLoadingState');
  ls.classList.remove('hidden');
  const dotsEl = document.getElementById('authLoadingDots');
  let dots = 0;
  dotsEl.textContent = 'Preparing your workspace';
  authLoadingInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    dotsEl.textContent = 'Preparing your workspace' + '.'.repeat(dots);
  }, 450);
}

function hideAuthLoading() {
  if (authLoadingInterval) {
    clearInterval(authLoadingInterval);
    authLoadingInterval = null;
  }
  const ls = document.getElementById('authLoadingState');
  if (ls) ls.classList.add('hidden');
  const af = document.querySelector('#authScreen .auth-form');
  if (af) af.classList.remove('hidden');
  const subtitle = document.querySelector('#authScreen .auth-subtitle');
  if (subtitle) subtitle.classList.remove('hidden');
}

async function preloadWorkspace() {
  const canManageSettings = can('settings', 'manage');
  const tasks = [api.loadStock(), api.listRecipes(), api.getInventoryConfig()];
  if (canManageSettings) {
    tasks.push(api.getSettings(), api.getPermissions(), api.listStaff(), api.getPosSales('today'));
  }

  const [results] = await Promise.all([Promise.all(tasks), loadPurchaseRegister()]);
  const stockRes = results[0];
  const recipesRes = results[1];
  const configRes = results[2];
  let settingsRes = null, permissionsRes = null, staffRes = null, posSalesRes = null;
  if (canManageSettings) {
    settingsRes = results[3];
    permissionsRes = results[4];
    staffRes = results[5];
    posSalesRes = results[6];
  }

  const arr = (stockRes && Array.isArray(stockRes.categories)) ? stockRes.categories : (Array.isArray(stockRes) ? stockRes : []);
        state.categories = arr.map(c => ({ id: c.id, name: c.name, icon: c.icon || 'default', items: (c.items || []).map(it => ({ id: it.id, name: it.name, qty: Number(it.qty) || 0, custom: !!it.custom, unit: it.unit || undefined, volume: it.volume !== undefined ? it.volume : undefined, volumeUnit: it.volumeUnit || undefined, salesVolume: it.salesVolume, salesVolumeUnit: it.salesVolumeUnit || null, servingName: it.servingName || null, remainingVolume: it.remainingVolume, remainingVolumeUnit: it.remainingVolumeUnit || null, containerVolume: it.containerVolume, editable: it.editable, locked: it.locked, lastConfirmedQty: Number(it.qty) || 0 })) }));
  saveCache();

  recipeState.recipes = (recipesRes && Array.isArray(recipesRes.recipes)) ? recipesRes.recipes : (recipesRes && Array.isArray(recipesRes) ? recipesRes : []);

  appConfig.units = (configRes && configRes.inventory && Array.isArray(configRes.inventory.units)) ? configRes.inventory.units : [];
  appConfig.adjustmentReasons = (configRes && configRes.inventory && configRes.inventory.adjustmentReasons) ? configRes.inventory.adjustmentReasons : { increase: [], decrease: [] };

  if (canManageSettings) {
    settingsData = (settingsRes && settingsRes.settings) ? settingsRes.settings : settingsRes;
    cachedPermissionsData = permissionsRes;
    cachedStaffData = (staffRes && staffRes.staff) ? staffRes.staff : [];
    cachedPosSalesData = posSalesRes;
  } else {
    settingsData = null;
    cachedPermissionsData = null;
    cachedStaffData = null;
    cachedPosSalesData = null;
  }

  try {
    const r = localStorage.getItem(EXPANDED_KEY);
    expandedState = r ? JSON.parse(r) : {};
  } catch (e) { expandedState = {}; }
  if (!Object.keys(expandedState).length && state.categories[0]) expandedState[state.categories[0].id] = true;
  render();
  setOnline(true);
  hideAuthLoading();
}

loginBtn.addEventListener('click', async () => {
  const username = usernameEl.value.trim();
  if (!username) { authErr.textContent = 'Enter username'; return; }
  const pin = pinEl.value.trim();
  if (!pin) { authErr.textContent = 'Enter PIN'; return; }
  authErr.textContent = '';
  loginBtn.disabled = true;
  showAuthLoading();
  try {
    const r = await api.login(username, pin);
    if (r && r.token) {
      authToken = r.token;
      setToken(authToken);
      userPermissions = r.permissions || {};
      savePermissions(userPermissions);
      if (r.restaurant) applyBranding(r.restaurant);
      if (r.user && r.user.name) document.getElementById('brandSub').textContent = r.user.name;
      await preloadWorkspace();
      showApp();
    } else {
      hideAuthLoading();
      authErr.textContent = 'Invalid response from server.';
      loginBtn.disabled = false;
    }
  } catch (e) {
    hideAuthLoading();
    pinEl.value = '';
    authErr.textContent = e.message || 'Login failed';
    loginBtn.disabled = false;
  }
});

usernameEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    pinEl.focus();
  }
});

pinEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    loginBtn.click();
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try { if (authToken) await api.logout(); } catch (e) { }
  clearAuth();
  showLogin();
});

function clearAuth() {
  authToken = null;
  restaurantData = null;
  delToken();
  delStoredRestaurant();
  userPermissions = {};
  clearPermissions();
  state.categories = [];
  const cr = document.getElementById('categoriesRoot');
  if (cr) cr.innerHTML = '';
  updateOverview();
  resetLogos();
  clearCache();
}

window.showLogin = showLogin;
window.showApp = showApp;
window.showAuthLoading = showAuthLoading;
window.hideAuthLoading = hideAuthLoading;
window.preloadWorkspace = preloadWorkspace;
window.clearAuth = clearAuth;