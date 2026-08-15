'use strict';

const API_BASE = 'https://restaurant-stock-waed.onrender.com/api';
const REQUEST_TIMEOUT_MS = 15000;
const STORAGE_KEY_TOKEN = 'stock_counter_token';
const RESTAURANT_KEY = 'sc_restaurant';
const EXPANDED_KEY = 'sc_expanded';
const CACHE_KEY = 'sc_inv_cache';
const CACHE_MAX_AGE = 10 * 60 * 1000;
const GENERIC_LOGO = 'assets/stock-logo.png';

let appConfig = { units: [], adjustmentReasons: [] };

const ICONS = {
  wine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8l-1 6a3 3 0 0 1-6 0L8 3z"/><path d="M12 12v6"/><path d="M9 21h6"/></svg>',
  bubbles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6l-.7 5A2.3 2.3 0 0 1 12 10a2.3 2.3 0 0 1-2.3-2L9 3z"/><path d="M12 10v11"/><path d="M8.5 21h7"/><circle cx="15.5" cy="6" r="0.6" fill="currentColor" stroke="none"/><circle cx="14.5" cy="4" r="0.5" fill="currentColor" stroke="none"/></svg>',
  tap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9h8l-1 10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2L7 9z"/><path d="M9 9V6a3 3 0 0 1 3-3h2a2 2 0 0 1 2 2"/></svg>',
  default: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>'
};

let state = { categories: [] };
let expandedState = {};
let restaurantName = '';
let isOnline = true;
let isDirty = false;
let isSaving = false;
let editingItemId = null;
let editingCategoryId = null;
let confirmCallback = null;
let activeItemId = null;
let authToken = null;
let restaurantData = null;
let recipeState = { recipes: [] };
let editingRecipeId = null;
let currentPage = 'inventory';
let pendingAllocations = [];
let currentAllocationDetails = null;
let authLoadingInterval = null;
let settingsData = null;
let settingsSubPage = null;
let salesFileHash = null;
let salesPeriodStart = null;
let salesPeriodEnd = null;
let salesItems = [];
let cachedPermissionsData = null;
let cachedStaffData = null;
let cachedPosSalesData = null;
let cachedPackagesData = null;
let managingPackagesForItemId = null;
let editingPackageId = null;
let pendingAdjustmentUpdates = [];
let userPermissions = {};
let shouldOpenAllocations = false;

const PERMISSIONS_KEY = 'sc_permissions';

function loadPermissions() {
  try {
    const v = localStorage.getItem(PERMISSIONS_KEY);
    return v ? JSON.parse(v) : {};
  } catch (e) { return {}; }
}

function savePermissions(perms) {
  try {
    localStorage.setItem(PERMISSIONS_KEY, JSON.stringify(perms));
  } catch (e) {
    console.error('Failed to save permissions:', e);
  }
}

function clearPermissions() {
  try { localStorage.removeItem(PERMISSIONS_KEY); } catch (e) { }
}

function can(module, action) {
  const modPerms = userPermissions[module];
  return modPerms && typeof modPerms === 'object' && modPerms[action] === true;
}

window.API_BASE = API_BASE;
window.REQUEST_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
window.STORAGE_KEY_TOKEN = STORAGE_KEY_TOKEN;
window.RESTAURANT_KEY = RESTAURANT_KEY;
window.EXPANDED_KEY = EXPANDED_KEY;
window.CACHE_KEY = CACHE_KEY;
window.CACHE_MAX_AGE = CACHE_MAX_AGE;
window.GENERIC_LOGO = GENERIC_LOGO;
window.appConfig = appConfig;
window.ICONS = ICONS;
window.state = state;
window.expandedState = expandedState;
window.restaurantName = restaurantName;
window.isOnline = isOnline;
window.isDirty = isDirty;
window.isSaving = isSaving;
window.editingItemId = editingItemId;
window.editingCategoryId = editingCategoryId;
window.confirmCallback = confirmCallback;
window.activeItemId = activeItemId;
window.authToken = authToken;
window.restaurantData = restaurantData;
window.recipeState = recipeState;
window.editingRecipeId = editingRecipeId;
window.currentPage = currentPage;
window.pendingAllocations = pendingAllocations;
window.currentAllocationDetails = currentAllocationDetails;
window.authLoadingInterval = authLoadingInterval;
window.settingsData = settingsData;
window.settingsSubPage = settingsSubPage;
window.salesFileHash = salesFileHash;
window.salesPeriodStart = salesPeriodStart;
window.salesPeriodEnd = salesPeriodEnd;
window.salesItems = salesItems;
window.cachedPermissionsData = cachedPermissionsData;
window.cachedStaffData = cachedStaffData;
window.cachedPosSalesData = cachedPosSalesData;
window.cachedPackagesData = cachedPackagesData;
window.managingPackagesForItemId = managingPackagesForItemId;
window.editingPackageId = editingPackageId;
window.pendingAdjustmentUpdates = pendingAdjustmentUpdates;
window.userPermissions = userPermissions;
window.shouldOpenAllocations = shouldOpenAllocations;
window.PERMISSIONS_KEY = PERMISSIONS_KEY;
window.loadPermissions = loadPermissions;
window.savePermissions = savePermissions;
window.clearPermissions = clearPermissions;
window.can = can;