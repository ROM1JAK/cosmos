window.CosmosModules = window.CosmosModules || {};
window.CosmosModules.auth = { scope: 'auth', mode: 'module' };

function toggleNotifications() {
	notificationsEnabled = !notificationsEnabled;
	const btn = document.getElementById('btn-notif-toggle');
	if (btn) {
		btn.innerHTML = notificationsEnabled
			? '<i class="fa-solid fa-bell"></i> Notifs : ON'
			: '<i class="fa-solid fa-bell-slash"></i> Notifs : OFF';
		btn.style.opacity = notificationsEnabled ? '1' : '0.5';
	}
}

function openAccountUI() {
	if (PLAYER_ID) openUserSettingsModal();
	else openLoginModal();
}

function openLoginModal() {
	document.getElementById('login-modal').classList.remove('hidden');
	document.getElementById('login-error-msg').style.display = 'none';
}

function closeLoginModal() {
	document.getElementById('login-modal').classList.add('hidden');
}

function submitLogin() {
	const pseudo = document.getElementById('loginPseudoInput').value.trim();
	const code = document.getElementById('loginCodeInput').value.trim();
	if (pseudo && code) socket.emit('login_request', { username: pseudo, code: code });
}

function logoutUser() {
	if (confirm('Déconnexion ?')) {
		localStorage.removeItem('rp_username');
		localStorage.removeItem('rp_code');
		localStorage.removeItem('saved_char_id');
		localStorage.removeItem('last_tab');
		localStorage.removeItem('last_tab_time');
		localStorage.removeItem('last_tab_user_id');
		location.reload();
	}
}

function openUserSettingsModal() {
	document.getElementById('settingsUsernameInput').value = USERNAME || '';
	document.getElementById('settingsCodeInput').value = PLAYER_ID || '';
	document.getElementById('settings-msg').textContent = '';
	const w = document.getElementById('admin-alert-btn-wrapper');
	if (w) {
		if (IS_ADMIN) w.classList.remove('hidden');
		else w.classList.add('hidden');
	}
	document.getElementById('user-settings-modal').classList.remove('hidden');
}

function closeUserSettingsModal() {
	document.getElementById('user-settings-modal').classList.add('hidden');
}

function toggleSecretVisibility() {
	const i = document.getElementById('settingsCodeInput');
	i.type = i.type === 'password' ? 'text' : 'password';
}

function submitUsernameChange() {
	const newName = document.getElementById('settingsUsernameInput').value.trim();
	if (newName && newName !== USERNAME) socket.emit('change_username', { userId: PLAYER_ID, newUsername: newName });
	else document.getElementById('settings-msg').textContent = 'Pas de changement.';
}

function changeTheme(themeName) {
	if (themeName === 'ombra') {
		openOmbra();
		return;
	}
	document.body.setAttribute('data-theme', themeName);
	document.querySelectorAll('.theme-swatch').forEach(btn => btn.classList.remove('active'));

	let activeColor = '#6c63ff';
	if (themeName === 'matrix') activeColor = '#00d4aa';
	if (themeName === 'blood') activeColor = '#ff4757';
	if (themeName === 'cyber') activeColor = '#f9ca24';

	const activeBtn = Array.from(document.querySelectorAll('.theme-swatch')).find(b => b.style.getPropertyValue('--swatch').trim() === activeColor);
	if (activeBtn) activeBtn.classList.add('active');

	if (PLAYER_ID) socket.emit('save_theme', { userId: PLAYER_ID, theme: themeName });
}

function handleOmbraOverlayClick(e) {
	if (e.target === document.getElementById('ombra-modal')) closeOmbra();
}

function openOmbra() {
	document.getElementById('ombra-modal').classList.remove('hidden');
	socket.emit('ombra_join', { alias: ombraAlias });
}

function closeOmbra() {
	document.getElementById('ombra-modal').classList.add('hidden');
	socket.emit('ombra_leave', { alias: ombraAlias });
}

function sendOmbraMessage() {
	const input = document.getElementById('ombraInput');
	const content = input.value.trim();
	if (!content) return;
	socket.emit('ombra_message', {
		alias: ombraAlias,
		content,
		ownerId: PLAYER_ID,
		date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	});
	input.value = '';
}

function appendOmbraMessage(id, alias, content, date, isSelf) {
	const messages = document.getElementById('ombra-messages');
	const div = document.createElement('div');
	div.className = `ombra-msg ${isSelf ? 'ombra-self' : ''}`;
	div.id = `ombra-${id}`;
	const canDel = isSelf || IS_ADMIN;
	const delBtn = canDel ? `<button class="ombra-del-btn" onclick="deleteOmbraMsg('${id}')" title="Supprimer"><i class="fa-solid fa-trash"></i></button>` : '';
	div.innerHTML = `<span class="ombra-alias">${alias}</span><span class="ombra-content">${escapeHtml(content)}</span><span class="ombra-time">${date}</span>${delBtn}`;
	messages.appendChild(div);
	messages.scrollTop = messages.scrollHeight;
}

function deleteOmbraMsg(id) {
	if (!confirm('Supprimer ce message Ombra ?')) return;
	socket.emit('ombra_delete_message', { msgId: id, requesterId: PLAYER_ID });
}

function syncAdminNavVisibility() {
	const adminBtn = document.getElementById('btn-view-admin');
	if (!adminBtn) return;
	adminBtn.classList.toggle('hidden', !IS_ADMIN);
}

function checkAutoLogin() {
	const savedUser = localStorage.getItem('rp_username');
	const savedCode = localStorage.getItem('rp_code');
	if (savedUser && savedCode) socket.emit('login_request', { username: savedUser, code: savedCode });
	else openLoginModal();
}
