'use strict';

const pgInv = document.getElementById('pageInventory');
const pgRec = document.getElementById('pageRecipes');
const pgSet = document.getElementById('pageSettings');
const pgSI = document.getElementById('pageStockIntake');
const pgSales = document.getElementById('pageSales');
const navInv = document.getElementById('navInventory');
const navRec = document.getElementById('navRecipes');
const navSet = document.getElementById('navSettings');
const navSI = document.getElementById('navStockIntake');
const navSales = document.getElementById('navSales');
const fab = document.getElementById('fabAction');
const fabLbl = document.getElementById('fabActionLabel');
const svBtn = document.getElementById('saveBtn');

function switchPage(p) {
  currentPage = p;
  pgInv.classList.add('hidden');
  pgRec.classList.add('hidden');
  pgSet.classList.add('hidden');
  pgSI.classList.add('hidden');
  pgSales.classList.add('hidden');
  navInv.classList.remove('active');
  navRec.classList.remove('active');
  navSet.classList.remove('active');
  navSI.classList.remove('active');
  navSales.classList.remove('active');
  fab.classList.add('hidden');
  svBtn.classList.add('hidden');

  if (p === 'inventory') {
    pgInv.classList.remove('hidden');
    navInv.classList.add('active');
    fabLbl.textContent = 'Actions';
    if (isDirty) svBtn.classList.remove('hidden');
    fab.classList.toggle('hidden', !can('inventory', 'add'));
  } else if (p === 'recipes') {
    pgRec.classList.remove('hidden');
    navRec.classList.add('active');
    fabLbl.textContent = 'Add Recipe';
    fab.classList.toggle('hidden', !can('recipes', 'create'));
    if (recipeState.recipes.length === 0) loadRecipes();
    else renderRecipes();
    if (can('allocations', 'list')) loadPendingAllocations();
  } else if (p === 'stockintake') {
    pgSI.classList.remove('hidden');
    navSI.classList.add('active');
    fab.classList.add('hidden');
    showStockIntakePage();
  } else if (p === 'sales') {
    pgSales.classList.remove('hidden');
    navSales.classList.add('active');
    fab.classList.add('hidden');
    showSalesDetail();
  } else if (p === 'settings') {
    pgSet.classList.remove('hidden');
    navSet.classList.add('active');
    fab.classList.add('hidden');
    if (!settingsData) loadSettings();
    else showSettingsMenu();
  }
  applyUIPermissions();
}

function applyUIPermissions() {
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) exportBtn.classList.toggle('hidden', !can('inventory', 'view'));

  if (currentPage === 'inventory') {
    fab.classList.toggle('hidden', !can('inventory', 'add'));
  } else if (currentPage === 'recipes') {
    fab.classList.toggle('hidden', !can('recipes', 'create'));
  } else {
    fab.classList.add('hidden');
  }
  navSet.classList.toggle('hidden', !can('settings', 'manage'));
  navSI.classList.toggle('hidden', !can('settings', 'manage'));
  navSales.classList.toggle('hidden', !can('settings', 'manage'));
}

navInv.addEventListener('click', () => switchPage('inventory'));
navRec.addEventListener('click', () => switchPage('recipes'));
navSI.addEventListener('click', () => switchPage('stockintake'));
navSales.addEventListener('click', () => switchPage('sales'));
navSet.addEventListener('click', () => switchPage('settings'));

fab.addEventListener('click', () => {
  if (currentPage === 'inventory') {
    if (!can('inventory', 'add')) {
      toast('You do not have permission to add items.', true);
      return;
    }
    if (!state.categories.length) {
      toast('No categories loaded.', true);
      return;
    }
    document.getElementById('actionAddCategory').classList.toggle('hidden', !can('categories', 'add'));
    openModal(document.getElementById('actionSheetOverlay'));
  } else {
    if (!can('recipes', 'create')) {
      toast('You do not have permission to create recipes.', true);
      return;
    }
    openRecipeModal(null);
  }
});

document.getElementById('actionSheetCancel').addEventListener('click', () => {
  closeModal(document.getElementById('actionSheetOverlay'));
});

document.getElementById('actionAddItem').addEventListener('click', () => {
  closeModal(document.getElementById('actionSheetOverlay'));
  if (!state.categories.length) {
    toast('No categories loaded.', true);
    return;
  }
  popCatSel();
  document.getElementById('newItemName').value = '';
  document.getElementById('newItemQty').value = 0;
  document.getElementById('newItemVolume').value = '';
  document.getElementById('newItemSalesVolume').value = '';
  document.getElementById('newItemServingName').value = '';
  popStockUnitSel(document.getElementById('newItemUnit'));
  popVolumeUnitSel(document.getElementById('newItemVolumeUnit'));
  popSalesVolumeUnitSel(document.getElementById('newItemSalesVolumeUnit'));
  refreshServingNameSuggestions();
  syncServingVisibility();
  openModal(document.getElementById('addModalOverlay'));
  setTimeout(() => document.getElementById('newItemName').focus(), 250);
});

document.getElementById('actionAddCategory').addEventListener('click', () => {
  closeModal(document.getElementById('actionSheetOverlay'));
  openCatDialog('add');
});

window.pgInv = pgInv;
window.pgRec = pgRec;
window.pgSet = pgSet;
window.pgSI = pgSI;
window.pgSales = pgSales;
window.navInv = navInv;
window.navRec = navRec;
window.navSet = navSet;
window.navSI = navSI;
window.navSales = navSales;
window.fab = fab;
window.fabLbl = fabLbl;
window.svBtn = svBtn;
window.switchPage = switchPage;
window.applyUIPermissions = applyUIPermissions;