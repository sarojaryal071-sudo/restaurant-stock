'use strict';

function toast(msg, err = false) {
  const s = document.getElementById('toastStack');
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' error' : '');
  t.innerHTML = (err
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>') + '<span></span>';
  t.querySelector('span').textContent = msg;
  s.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 3200);
}

function setOnline(o) {
  isOnline = o;
  document.getElementById('connBanner').classList.toggle('hidden', o);
}

document.getElementById('connBannerRetry').addEventListener('click', async () => {
  try {
    await api.health();
    setOnline(true);
    toast('Connection restored');
  } catch (e) {
    toast('Still offline', true);
  }
});

window.toast = toast;
window.setOnline = setOnline;