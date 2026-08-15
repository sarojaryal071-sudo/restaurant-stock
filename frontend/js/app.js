'use strict';

function tick() {
  const n = new Date();
  document.getElementById('clockTime').textContent = fmtTime(n);
  document.getElementById('clockDate').textContent = fmtDate(n);
}

document.getElementById('statusRetryBtn').addEventListener('click', init);

async function init() {
  document.getElementById('loadingScreen').classList.remove('fade-out');
  appEl.classList.add('hidden');
  authSc.classList.add('hidden');
  document.getElementById('statusScreen').classList.add('hidden');
  const storedToken = getToken();
  if (!storedToken) {
    showLogin();
    return;
  }
  authToken = storedToken;
  userPermissions = loadPermissions();
  document.getElementById('loadingText').textContent = 'Checking session…';
  try {
    const h = await api.health();
    if (h && h.restaurant) {
      userPermissions = h.permissions || loadPermissions();
      savePermissions(userPermissions);
      applyBranding(h.restaurant);
      if (h.user && h.user.name) document.getElementById('brandSub').textContent = h.user.name;
      document.getElementById('loadingText').textContent = 'Preparing your workspace…';
      try {
        await preloadWorkspace();
      } catch (e) {
        await loadInventory();
      }
      showApp();
      return;
    }
    clearAuth();
    showLogin();
  } catch (e) {
    clearAuth();
    showLogin();
  }
}

tick();
setInterval(tick, 60000);
init();

window.tick = tick;
window.init = init;
window.api = api;
window.can = can;
window.userPermissions = userPermissions;