'use strict';

function openModal(o) {
  o.classList.add('open');
}

function closeModal(o) {
  o.classList.remove('open');
}

function openConfirm(title, bodyHtml, onConfirm, okLabel = 'Delete') {
  const ct = document.getElementById('confirmTitle');
  const cb = document.getElementById('confirmBody');
  const cok = document.getElementById('confirmOk');
  ct.textContent = title;
  cb.innerHTML = bodyHtml;
  cok.textContent = okLabel;
  confirmCallback = onConfirm;
  openModal(document.getElementById('confirmOverlay'));
}

document.getElementById('confirmCancel').addEventListener('click', () => {
  closeModal(document.getElementById('confirmOverlay'));
  confirmCallback = null;
});

document.getElementById('confirmOk').addEventListener('click', async () => {
  const cbFn = confirmCallback;
  closeModal(document.getElementById('confirmOverlay'));
  confirmCallback = null;
  if (typeof cbFn === 'function') {
    const cok = document.getElementById('confirmOk');
    cok.disabled = true;
    cok.textContent = 'Working…';
    try {
      await cbFn();
    } finally {
      cok.disabled = false;
      cok.textContent = 'Delete';
    }
  }
});

function closeMenus() {
  const m = document.getElementById('contextMenu');
  m.classList.remove('open');
  m._anchor = null;
  document.querySelectorAll('.context-open').forEach(e => e.classList.remove('context-open'));
}

function openCtx(anchor, items) {
  closeMenus();
  const ctxMenu = document.getElementById('contextMenu');
  ctxMenu.innerHTML = '';
  items.forEach(it => {
    const b = document.createElement('button');
    b.className = 'context-menu-item' + (it.danger ? ' danger' : '');
    b.innerHTML = (it.icon || '') + '<span>' + escapeHtml(it.label) + '</span>';
    b.addEventListener('click', ev => {
      ev.stopPropagation();
      closeMenus();
      if (typeof it.action === 'function') it.action();
    });
    ctxMenu.appendChild(b);
  });
  const r = anchor.getBoundingClientRect();
  const mh = ctxMenu.scrollHeight || 180;
  const mw = ctxMenu.scrollWidth || 180;
  let top = r.bottom + 4;
  let left = r.right - mw;
  if (left < 8) left = r.left;
  if (top + mh > window.innerHeight - 20) top = r.top - mh - 4;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if (left < 8) left = 8;
  ctxMenu.style.top = top + 'px';
  ctxMenu.style.left = left + 'px';
  ctxMenu._anchor = anchor;
  anchor.classList.add('context-open');
  requestAnimationFrame(() => ctxMenu.classList.add('open'));
}

document.addEventListener('click', e => {
  const ctxMenu = document.getElementById('contextMenu');
  if (ctxMenu.classList.contains('open') && !ctxMenu.contains(e.target) && e.target !== ctxMenu._anchor) {
    closeMenus();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('contextMenu').classList.contains('open')) {
    closeMenus();
  }
});

window.addEventListener('scroll', () => {
  if (document.getElementById('contextMenu').classList.contains('open')) closeMenus();
}, { passive: true });

window.addEventListener('resize', () => {
  if (document.getElementById('contextMenu').classList.contains('open')) closeMenus();
});

const modalOverlays = [
  'actionSheetOverlay', 'editItemOverlay', 'confirmOverlay', 'categoryDialogOverlay',
  'addModalOverlay', 'resetModalOverlay', 'recipeModalOverlay', 'resolveAllocationModal',
  'staffAddModalOverlay', 'staffEditModalOverlay', 'adjustReasonModalOverlay',
  'packageManagerModalOverlay', 'purchaseModalOverlay', 'purchaseDetailsModalOverlay'
];

modalOverlays.forEach(id => {
  const o = document.getElementById(id);
  if (o) {
    o.addEventListener('click', e => {
      if (e.target === o) closeModal(o);
    });
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    modalOverlays.forEach(id => {
      const o = document.getElementById(id);
      if (o) closeModal(o);
    });
  }
});

window.openModal = openModal;
window.closeModal = closeModal;
window.openConfirm = openConfirm;
window.closeMenus = closeMenus;
window.openCtx = openCtx;