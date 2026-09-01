'use strict';

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function qtyClass(q) {
  if (q < 0) return 'negative';
  if (q <= 0) return 'zero';
  if (q <= 5) return 'low';
  return 'good';
}

function pluralizeUnit(qty, unit) {
  if (!unit) return '';
  const n = parseFloat(qty);
  if (isNaN(n) || n === 1) return unit;
  return /s$/i.test(unit) ? unit : unit + 's';
}

/**
 * Format the backend-provided whole-units + remaining-volume pair into a
 * human-readable line, e.g. "1 Bottle + 40 ml" or "2 Kegs + 4 L".
 * Presentation only — does not recalculate or invent any value; the
 * numbers themselves always come from the backend (items.volume /
 * remainingVolume via loadStock).
 */
function formatStockRemainder(wholeUnits, unit, remainingVolume, remainingVolumeUnit) {
  const unitLabel = pluralizeUnit(wholeUnits, unit || 'unit');
  const capLabel = unitLabel.charAt(0).toUpperCase() + unitLabel.slice(1);
  return `${wholeUnits} ${capLabel} + ${remainingVolume} ${remainingVolumeUnit}`;
}

function fmtTime(d) {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function uid() {
  return 'tmp_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function findItem(id) {
  for (const c of state.categories) {
    const it = c.items.find(i => i.id === id);
    if (it) return { cat: c, item: it };
  }
  return null;
}

function findCat(id) {
  return state.categories.find(c => c.id === id) || null;
}

function getToken() {
  try { return localStorage.getItem(STORAGE_KEY_TOKEN); } catch (e) { return null; }
}

function setToken(t) {
  try { localStorage.setItem(STORAGE_KEY_TOKEN, t); } catch (e) { }
}

function delToken() {
  try { localStorage.removeItem(STORAGE_KEY_TOKEN); } catch (e) { }
}

function getStoredRestaurant() {
  try {
    const v = localStorage.getItem(RESTAURANT_KEY);
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
}

function setStoredRestaurant(d) {
  try { localStorage.setItem(RESTAURANT_KEY, JSON.stringify(d)); } catch (e) { }
}

function delStoredRestaurant() {
  try { localStorage.removeItem(RESTAURANT_KEY); } catch (e) { }
}

function loadCache() {
  try {
    const r = localStorage.getItem(CACHE_KEY);
    if (!r) return false;
    const { timestamp, categories } = JSON.parse(r);
    if (Date.now() - timestamp < CACHE_MAX_AGE) {
      state.categories = categories;
      return true;
    }
  } catch (e) { }
  return false;
}

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), categories: state.categories }));
  } catch (e) { }
}

function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch (e) { }
}

function resetLogos() {
  const g = GENERIC_LOGO;
  ['headerLogo', 'authLogoImg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.src = g;
  });
  const li = document.querySelector('#loadingScreen .loading-logo img');
  if (li) li.src = g;
  const f = document.querySelector('link[rel="icon"]');
  if (f) f.href = g;
  const a = document.querySelector('link[rel="apple-touch-icon"]');
  if (a) a.href = g;
}

function applyBranding(r) {
  restaurantData = r;
  setStoredRestaurant(r);
  const dn = r.displayName || r.name || '';
  if (dn) {
    document.getElementById('brandName').textContent = dn;
    restaurantName = dn;
  }
  const logo = r.logoUrl || GENERIC_LOGO;
  document.getElementById('headerLogo').src = logo;
  document.getElementById('authLogoImg').src = logo;
  const li = document.querySelector('#loadingScreen .loading-logo img');
  if (li) li.src = logo;
  const f = document.querySelector('link[rel="icon"]');
  if (f) f.href = logo;
  const a = document.querySelector('link[rel="apple-touch-icon"]');
  if (a) a.href = logo;
  if (r.themeColor) document.documentElement.style.setProperty('--ember-1', r.themeColor);
}

// -------------------------------------------------------------------
// Light/Dark theme — preference only, never sent to the backend.
// A tiny inline script in index.html <head> stamps data-theme
// synchronously before first paint to avoid a flash; these helpers
// handle the explicit toggle from here on.
// -------------------------------------------------------------------
const THEME_KEY = 'sc_theme';

function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function setTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { }
}

function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

const themeToggleBtn = document.getElementById('themeToggleBtn');
if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);

window.escapeHtml = escapeHtml;
window.cssEscape = cssEscape;
window.qtyClass = qtyClass;
window.pluralizeUnit = pluralizeUnit;
window.fmtTime = fmtTime;
window.fmtDate = fmtDate;
window.uid = uid;
window.findItem = findItem;
window.findCat = findCat;
window.getToken = getToken;
window.setToken = setToken;
window.delToken = delToken;
window.getStoredRestaurant = getStoredRestaurant;
window.setStoredRestaurant = setStoredRestaurant;
window.delStoredRestaurant = delStoredRestaurant;
window.loadCache = loadCache;
window.saveCache = saveCache;
window.clearCache = clearCache;
window.resetLogos = resetLogos;
window.applyBranding = applyBranding;
window.formatStockRemainder = formatStockRemainder;
window.THEME_KEY = THEME_KEY;
window.getTheme = getTheme;
window.setTheme = setTheme;
window.toggleTheme = toggleTheme;