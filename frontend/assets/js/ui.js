window.CosmosModules = window.CosmosModules || {};
window.CosmosModules.ui = { scope: 'ui', mode: 'module' };

function toggleSidebar(forceOpen) {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-overlay');
  if (!sidebar || !overlay) return;
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', shouldOpen);
  overlay.classList.toggle('open', shouldOpen);
  if (shouldOpen && typeof closeTopNavMenu === 'function') closeTopNavMenu();
}

function toggleCreateForm() {
  openCharModal('create');
}

function switchCharTab(mode, tab) {
  const prefix = mode === 'create' ? 'create' : 'edit';
  document.querySelectorAll(`#char-modal-${mode} .char-tab-content`).forEach(el => el.classList.remove('active-tab'));
  document.querySelectorAll(`#char-modal-${mode} .char-tab`).forEach(el => el.classList.remove('active'));
  const content = document.getElementById(`${prefix}-tab-${tab}`);
  if (content) content.classList.add('active-tab');
  const tabs = document.querySelectorAll(`#char-modal-${mode} .char-tab`);
  const tabNames = ['identite', 'parti', 'entreprises', 'capital'];
  const idx = tabNames.indexOf(tab);
  if (tabs[idx]) tabs[idx].classList.add('active');
}

let _formSnaps = {};
let _unsavedBypass = false;
let _pendingCloseFn = null;

function snapForm(modalId) {
  const el = document.getElementById(modalId);
  if (!el) return;
  const snap = {};
  el.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([type=color]):not([type=range]), textarea, select').forEach(f => {
    const key = f.id || f.getAttribute('name');
    if (key) snap[key] = f.value;
  });
  _formSnaps[modalId] = snap;
}

function isFormDirty(modalId) {
  const el = document.getElementById(modalId);
  const snap = _formSnaps[modalId];
  if (!el || !snap) return false;
  const fields = el.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=submit]):not([type=button]):not([type=color]):not([type=range]), textarea, select');
  for (const f of fields) {
    const key = f.id || f.getAttribute('name');
    if (key && snap[key] !== undefined && snap[key] !== f.value) return true;
  }
  return false;
}

function guardClose(modalId, closeFn) {
  if (_unsavedBypass || !isFormDirty(modalId)) {
    _unsavedBypass = false;
    closeFn();
    return;
  }
  _pendingCloseFn = closeFn;
  const modal = document.getElementById('unsaved-modal');
  if (modal) modal.classList.remove('hidden');
  else if (confirm('Quitter sans enregistrer ?')) closeFn();
}

function unsavedConfirm() {
  document.getElementById('unsaved-modal').classList.add('hidden');
  if (_pendingCloseFn) {
    _pendingCloseFn();
    _pendingCloseFn = null;
  }
}

function unsavedCancel() {
  document.getElementById('unsaved-modal').classList.add('hidden');
  _pendingCloseFn = null;
  _unsavedBypass = false;
}

function openCharModal(mode) {
  document.getElementById('char-modal').classList.remove('hidden');
  if (mode === 'create') {
    document.getElementById('char-modal-title').textContent = '✨ Nouveau Personnage';
    document.getElementById('char-modal-create').classList.remove('hidden');
    document.getElementById('char-modal-edit').classList.add('hidden');
  } else {
    document.getElementById('char-modal-title').textContent = '✏️ Modifier le Personnage';
    document.getElementById('char-modal-create').classList.add('hidden');
    document.getElementById('char-modal-edit').classList.remove('hidden');
  }
  snapForm('char-modal');
}

function closeCharModal() {
  guardClose('char-modal', () => {
    document.getElementById('char-modal').classList.add('hidden');
    newCharCompanies = [];
    const list = document.getElementById('newCharCompaniesList');
    if (list) list.innerHTML = '';
    editCharCompanies = [];
    const editList = document.getElementById('editCharCompaniesList');
    if (editList) editList.innerHTML = '';
  });
}

function loadCosmosMapModule() {
  if (window.__cosmosMapLoaded || window.__cosmosMapLoading) return;
  window.__cosmosMapLoading = true;

  var mapScript = document.createElement('script');
  mapScript.src = 'assets/js/map.js';
  mapScript.onload = function () {
    window.__cosmosMapLoaded = true;
    window.__cosmosMapLoading = false;
  };
  mapScript.onerror = function () {
    window.__cosmosMapLoading = false;
    console.error('Unable to load map module.');
  };

  document.body.appendChild(mapScript);
}

(function loadLegacyCosmosApp() {
  if (window.__cosmosLegacyLoaded || window.__cosmosLegacyLoading) return;
  window.__cosmosLegacyLoading = true;

  var script = document.createElement('script');
  script.src = 'assets/js/app.js';
  script.onload = function () {
    window.__cosmosLegacyLoaded = true;
    window.__cosmosLegacyLoading = false;
    loadCosmosMapModule();
  };
  script.onerror = function () {
    window.__cosmosLegacyLoading = false;
    console.error('Unable to load legacy client bundle.');
  };

  document.body.appendChild(script);
})();
