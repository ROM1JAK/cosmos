var socket = io();
const notifSound = new Audio('https://cdn.discordapp.com/attachments/1323488087288053821/1443747694408503446/notif.mp3?ex=692adb11&is=69298991&hm=8e0c05da67995a54740ace96a2e4630c367db762c538c2dffc11410e79678ed5&'); 

const CLOUDINARY_BASE_URL = 'https://api.cloudinary.com/v1_1/dllr3ugxz'; 
const CLOUDINARY_PRESET = 'Cosmos';

// --- DATA ---
let myCharacters = [];
let allRooms = []; 
let currentRoomId = 'global'; 
let currentDmTarget = null; 
let PLAYER_ID; 
let USERNAME; 
let IS_ADMIN = false;
let currentContext = null; 
let typingTimeout = null;
let unreadRooms = new Set();
let unreadDms = new Set(); 
let dmContacts = []; 
let firstUnreadMap = {}; 
let currentView = 'accueil'; 
let notificationsEnabled = true; 
let currentSelectedChar = null; 
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let allOnlineUsers = [];
let feedPostsCache = [];
let eventsCache = [];
let presseArticlesCache = [];

// FEED IDENTITY
let currentFeedCharId = null;
let feedTypers = new Set();
let feedTypingTimeout = null;

let pendingAttachment = null; 
let pendingCommentAttachment = null;
let lastMessageData = { author: null, time: 0, ownerId: null };
let pollOptions = [];
let pollUIOpen = false; 

// OMBRA
let ombraAlias = null;
let ombraHistory = [];

// PRESSE
let currentPresseCharId = null;

// ACTUALITÉS
let actuRequestPending = false;

const COMMON_EMOJIS = ["😀", "😂", "😉", "😍", "😎", "🥳", "😭", "😡", "🤔", "👍", "👎", "❤️", "💔", "🔥", "✨", "🎉", "💩", "👻", "💀", "👽", "🤖", "👋", "🙌", "🙏", "💪", "👀", "🍕", "🍻", "🚀", "💯"];

async function uploadToCloudinary(file, resourceType) {
    if (!file) return null;
    if (!resourceType) {
        if (file.type.startsWith('image/')) resourceType = 'image';
        else if (file.type.startsWith('video/') || file.type.startsWith('audio/')) resourceType = 'video';
        else resourceType = 'auto';
    }
    const formData = new FormData();
    if (file instanceof Blob && !file.name) {
        const ext = file.type.split('/')[1] || 'dat';
        formData.append('file', file, `upload.${ext}`);
    } else { formData.append('file', file); }
    formData.append('upload_preset', CLOUDINARY_PRESET);
    const uploadUrl = `${CLOUDINARY_BASE_URL}/${resourceType}/upload`;
    try {
        const response = await fetch(uploadUrl, { method: 'POST', body: formData });
        if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
        const data = await response.json(); return data.secure_url; 
    } catch (error) { console.error("Erreur Upload:", error); alert("Erreur envoi média : " + error.message); return null; }
}

function switchView(view) {
    currentView = view;
    localStorage.setItem('last_tab', view);
    localStorage.setItem('last_tab_time', Date.now().toString());
    document.querySelectorAll('.view-section').forEach(el => { el.classList.remove('active'); el.classList.add('hidden'); });
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    const viewEl = document.getElementById(`view-${view}`);
    const btnEl = document.getElementById(`btn-view-${view}`);
    if(viewEl) { viewEl.classList.remove('hidden'); viewEl.classList.add('active'); }
    if(btnEl) btnEl.classList.add('active');
    if(view === 'feed') {
        document.getElementById('btn-view-feed').classList.remove('nav-notify');
        localStorage.setItem('last_feed_visit', Date.now().toString());
        loadFeed();
    }
    if(view === 'presse') { loadPresse(); }
    if(view === 'actualites') {
        loadActualites(); updateActuAdminForm();
        const actuBadge = document.getElementById('actu-badge');
        if(actuBadge) actuBadge.classList.add('hidden');
        const actuBtn = document.getElementById('btn-view-actualites');
        if(actuBtn) actuBtn.classList.remove('nav-notify');
    }
    if(view === 'cites') { loadCities(); } // [CITÉS]
    if(view === 'bourse') { loadBourse(); updateBourseAdminUI(); }
    if(view === 'wiki') { loadWiki(); }
    if(view === 'accueil') { renderAccueil(); socket.emit('request_feed'); socket.emit('request_events'); if(!stocksData.length) socket.emit('request_stocks'); }
    if(view === 'mes-persos') { renderMesPersos(); }
    if(view === 'char-mp') {
        // Effacer le badge de notif
        const badge = document.getElementById('char-mp-badge');
        if(badge) { badge.classList.add('hidden'); badge.textContent = ''; }
        const btn = document.getElementById('btn-view-char-mp');
        if(btn) btn.classList.remove('nav-char-mp-unread');
        initCharMpView();
    }
}

function previewImg(input, previewId) {
    const preview = document.getElementById(previewId);
    if(!preview || !input.files || !input.files[0]) return;
    const reader = new FileReader();
    reader.onload = e => { preview.src = e.target.result; preview.classList.remove('hidden'); };
    reader.readAsDataURL(input.files[0]);
}

async function toggleRecording(source) { 
    const btn = document.getElementById(`btn-record-${source}`); if (!btn) return; 
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = []; mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.start(); isRecording = true; btn.classList.add('recording');
        } catch (err) { alert("Impossible d'accéder au micro : " + err); }
    } else {
        mediaRecorder.stop();
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            btn.classList.remove('recording'); isRecording = false;
            if (source === 'chat') { stageAttachment(audioBlob, 'audio'); } 
            else if (source === 'feed') {
                document.getElementById('postFileStatus').style.display = 'block'; document.getElementById('postFileStatus').innerHTML = 'Envoi audio...';
                const url = await uploadToCloudinary(audioBlob, 'video');
                if (url) { document.getElementById('postMediaUrl').value = url; document.getElementById('postFileStatus').innerHTML = 'Audio prêt <i class="fa-solid fa-check" style="color:#23a559"></i>'; } 
                else { document.getElementById('postFileStatus').innerHTML = 'Erreur envoi.'; }
            } else if (source === 'comment') { stageCommentMedia({ files: [audioBlob] }, 'audio'); }
        };
    }
}

function handleChatFileSelect(input, type) { if (input.files && input.files[0]) { stageAttachment(input.files[0], type); input.value = ""; } }
function stageAttachment(file, type) {
    pendingAttachment = { file, type };
    const stagingDiv = document.getElementById('chat-staging'); stagingDiv.classList.remove('hidden');
    let previewHTML = '';
    if (type === 'image') { const url = URL.createObjectURL(file); previewHTML = `<img src="${url}" class="staging-preview">`; } 
    else if (type === 'video') { previewHTML = `<div class="staging-preview" style="background:#000; color:white; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-video"></i></div>`; } 
    else if (type === 'audio') { previewHTML = `<div class="staging-preview" style="background:#222; color:white; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-microphone"></i></div>`; }
    stagingDiv.innerHTML = `${previewHTML}<span class="staging-info">${type === 'audio' ? 'Message Vocal' : file.name}</span><button class="btn-clear-stage" onclick="clearStaging()"><i class="fa-solid fa-xmark"></i></button>`;
}
function clearStaging() { pendingAttachment = null; document.getElementById('chat-staging').classList.add('hidden'); document.getElementById('chat-staging').innerHTML = ""; }

function setupEmojiPicker() {
    const picker = document.getElementById('emoji-picker'); picker.innerHTML = '';
    COMMON_EMOJIS.forEach(emoji => {
        const span = document.createElement('span'); span.className = 'emoji-item'; span.textContent = emoji;
        span.onclick = () => insertEmoji(emoji); picker.appendChild(span);
    });
}
function toggleEmojiPicker() { document.getElementById('emoji-picker').classList.toggle('hidden'); }
function insertEmoji(emoji) {
    const input = document.getElementById('txtInput');
    const start = input.selectionStart; const end = input.selectionEnd;
    input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
    input.selectionStart = input.selectionEnd = start + emoji.length; input.focus();
    document.getElementById('emoji-picker').classList.add('hidden');
}

document.getElementById('txtInput').addEventListener('input', function(e) {
    const input = e.target; const cursor = input.selectionStart; const textBefore = input.value.substring(0, cursor); const lastWord = textBefore.split(/\s/).pop();
    const suggestionsBox = document.getElementById('mention-suggestions');
    if (lastWord.startsWith('@')) {
        const query = lastWord.substring(1).toLowerCase();
        const matches = allOnlineUsers.filter(u => u.toLowerCase().startsWith(query));
        if (matches.length > 0) {
            suggestionsBox.innerHTML = '';
            matches.forEach(match => {
                const div = document.createElement('div'); div.className = 'mention-item'; div.textContent = match;
                div.onclick = () => {
                    const newText = textBefore.substring(0, textBefore.length - lastWord.length) + '@' + match + ' ' + input.value.substring(cursor);
                    input.value = newText; input.focus(); suggestionsBox.classList.add('hidden');
                }; suggestionsBox.appendChild(div);
            }); suggestionsBox.classList.remove('hidden');
        } else { suggestionsBox.classList.add('hidden'); }
    } else { suggestionsBox.classList.add('hidden'); }
});

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('mobile-overlay').classList.toggle('open'); }
function toggleCreateForm() { openCharModal('create'); }

// [NOUVEAU] Navigation onglets modale perso
function switchCharTab(mode, tab) {
    const prefix = mode === 'create' ? 'create' : 'edit';
    document.querySelectorAll(`#char-modal-${mode} .char-tab-content`).forEach(el => el.classList.remove('active-tab'));
    document.querySelectorAll(`#char-modal-${mode} .char-tab`).forEach(el => el.classList.remove('active'));
    const content = document.getElementById(`${prefix}-tab-${tab}`);
    if(content) content.classList.add('active-tab');
    // Activer le bouton correspondant
    const tabs = document.querySelectorAll(`#char-modal-${mode} .char-tab`);
    const tabNames = ['identite','parti','entreprises','capital'];
    const idx = tabNames.indexOf(tab);
    if(tabs[idx]) tabs[idx].classList.add('active');
}

// [NOUVEAU] Modales centrées pour création/édition de personnage
function openCharModal(mode) {
    document.getElementById('char-modal').classList.remove('hidden');
    if(mode === 'create') {
        document.getElementById('char-modal-title').textContent = '✨ Nouveau Personnage';
        document.getElementById('char-modal-create').classList.remove('hidden');
        document.getElementById('char-modal-edit').classList.add('hidden');
    } else {
        document.getElementById('char-modal-title').textContent = '✏️ Modifier le Personnage';
        document.getElementById('char-modal-create').classList.add('hidden');
        document.getElementById('char-modal-edit').classList.remove('hidden');
    }
}
function closeCharModal() {
    document.getElementById('char-modal').classList.add('hidden');
    newCharCompanies = [];
    const list = document.getElementById('newCharCompaniesList');
    if(list) list.innerHTML = '';
    editCharCompanies = [];
    const editList = document.getElementById('editCharCompaniesList');
    if(editList) editList.innerHTML = '';
}
function toggleNotifications() {
    notificationsEnabled = !notificationsEnabled; const btn = document.getElementById('btn-notif-toggle');
    if(btn) { btn.innerHTML = notificationsEnabled ? '<i class="fa-solid fa-bell"></i> Notifs : ON' : '<i class="fa-solid fa-bell-slash"></i> Notifs : OFF'; btn.style.opacity = notificationsEnabled ? "1" : "0.5"; }
}
function openAccountUI() { if (PLAYER_ID) openUserSettingsModal(); else openLoginModal(); }
function openLoginModal() { document.getElementById('login-modal').classList.remove('hidden'); document.getElementById('login-error-msg').style.display = "none"; }
function closeLoginModal() { document.getElementById('login-modal').classList.add('hidden'); }
function submitLogin() { const pseudo = document.getElementById('loginPseudoInput').value.trim(); const code = document.getElementById('loginCodeInput').value.trim(); if (pseudo && code) socket.emit('login_request', { username: pseudo, code: code }); }
function logoutUser() { if(confirm("Déconnexion ?")) { localStorage.removeItem('rp_username'); localStorage.removeItem('rp_code'); localStorage.removeItem('saved_char_id'); location.reload(); } }

function openUserSettingsModal() { 
    document.getElementById('settingsUsernameInput').value = USERNAME || ""; 
    document.getElementById('settingsCodeInput').value = PLAYER_ID || ""; 
    document.getElementById('settings-msg').textContent = ""; 
    // [FIX] Afficher bouton alerte admin directement ici (sans redéfinition)
    const w = document.getElementById('admin-alert-btn-wrapper');
    if(w) { if(IS_ADMIN) w.classList.remove('hidden'); else w.classList.add('hidden'); }
    document.getElementById('user-settings-modal').classList.remove('hidden'); 
}
function closeUserSettingsModal() { document.getElementById('user-settings-modal').classList.add('hidden'); }
function toggleSecretVisibility() { const i = document.getElementById('settingsCodeInput'); i.type = (i.type === "password") ? "text" : "password"; }
function submitUsernameChange() {
    const newName = document.getElementById('settingsUsernameInput').value.trim();
    if (newName && newName !== USERNAME) socket.emit('change_username', { userId: PLAYER_ID, newUsername: newName });
    else document.getElementById('settings-msg').textContent = "Pas de changement.";
}

// THEMES LOGIC
function changeTheme(themeName) {
    if(themeName === 'ombra') {
        openOmbra();
        return;
    }
    document.body.setAttribute('data-theme', themeName);
    document.querySelectorAll('.theme-swatch').forEach(btn => btn.classList.remove('active'));
    
    let activeColor = '#6c63ff'; 
    if(themeName === 'matrix') activeColor = '#00d4aa';
    if(themeName === 'blood') activeColor = '#ff4757';
    if(themeName === 'cyber') activeColor = '#f9ca24';

    const activeBtn = Array.from(document.querySelectorAll('.theme-swatch')).find(b => b.style.getPropertyValue('--swatch').trim() === activeColor);
    if(activeBtn) activeBtn.classList.add('active');

    if(PLAYER_ID) socket.emit('save_theme', { userId: PLAYER_ID, theme: themeName });
}

// OMBRA DARKWEB
function handleOmbraOverlayClick(e) { if(e.target === document.getElementById('ombra-modal')) closeOmbra(); }
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
    if(!content) return;
    socket.emit('ombra_message', { alias: ombraAlias, content, ownerId: PLAYER_ID, date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) });
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
    if(!confirm('Supprimer ce message Ombra ?')) return;
    socket.emit('ombra_delete_message', { msgId: id, requesterId: PLAYER_ID });
}
function escapeHtml(text) { const d = document.createElement('div'); d.appendChild(document.createTextNode(text)); return d.innerHTML; }

socket.on('ombra_message', (data) => { appendOmbraMessage(data._id, data.alias, data.content, data.date, data.alias === ombraAlias); });
socket.on('ombra_history', (history) => {
    const messages = document.getElementById('ombra-messages');
    messages.innerHTML = '';
    history.forEach(m => appendOmbraMessage(m._id, m.alias, m.content, m.date, m.alias === ombraAlias));
});
socket.on('ombra_message_deleted', (msgId) => {
    const el = document.getElementById(`ombra-${msgId}`);
    if(el) el.remove();
});

socket.on('login_success', (data) => {
    localStorage.setItem('rp_username', data.username);
    localStorage.setItem('rp_code', data.userId);
    USERNAME = data.username; PLAYER_ID = data.userId; IS_ADMIN = data.isAdmin;
    ombraAlias = data.ombraAlias || null;
    
    if(data.uiTheme) changeTheme(data.uiTheme);
    
    document.getElementById('player-id-display').textContent = `Compte : ${USERNAME}`;
    document.getElementById('btn-account-main').innerHTML = '<i class="fa-solid fa-user"></i> Mon Profil';
    const navAccBtn = document.getElementById('btn-nav-account');
    if(navAccBtn) { navAccBtn.classList.add('logged-in'); document.getElementById('nav-account-label').textContent = USERNAME; }
    closeLoginModal(); socket.emit('request_initial_data', PLAYER_ID); socket.emit('request_dm_contacts', USERNAME);
    const savedRoom = localStorage.getItem('saved_room_id'); joinRoom(savedRoom || 'global');
    switchView('accueil');
});
socket.on('login_error', (msg) => { const el = document.getElementById('login-error-msg'); el.textContent = msg; el.style.display = 'block'; });
socket.on('username_change_success', (newName) => { USERNAME = newName; localStorage.setItem('rp_username', newName); document.getElementById('player-id-display').textContent = `Compte : ${USERNAME}`; document.getElementById('settings-msg').textContent = "OK !"; });
socket.on('username_change_error', (msg) => { document.getElementById('settings-msg').textContent = msg; });

function checkAutoLogin() {
    const savedUser = localStorage.getItem('rp_username'); const savedCode = localStorage.getItem('rp_code');
    if (savedUser && savedCode) socket.emit('login_request', { username: savedUser, code: savedCode }); else openLoginModal();
}

socket.on('connect', () => { checkAutoLogin(); setupEmojiPicker(); });
socket.on('update_user_list', (users) => {
    allOnlineUsers = users;
    document.getElementById('online-count').textContent = users.length;
    // Demander les personnages des users en ligne
    socket.emit('request_all_chars_online');
});

socket.on('all_chars_online', (chars) => {
    const listDiv = document.getElementById('online-users-list');
    if(!listDiv) return;
    listDiv.innerHTML = '';
    if(!chars.length) {
        listDiv.innerHTML = '<div style="padding:14px 12px;color:var(--text-dim);font-size:0.78rem;font-style:italic;">Aucun personnage en ligne.</div>';
        return;
    }
    // Grouper par ownerUsername
    const grouped = {};
    chars.forEach(c => {
        if(!grouped[c.ownerUsername]) grouped[c.ownerUsername] = [];
        grouped[c.ownerUsername].push(c);
    });
    Object.entries(grouped).forEach(([owner, ownerChars]) => {
        // Header du joueur
        const ownerDiv = document.createElement('div');
        ownerDiv.className = 'online-owner-header';
        ownerDiv.innerHTML = `<span class="status-dot"></span><span class="online-owner-name">${owner}</span>`;
        listDiv.appendChild(ownerDiv);
        // Bloc encadré avec ses personnages
        const block = document.createElement('div');
        block.className = 'online-chars-block';
        ownerChars.forEach(char => {
            const item = document.createElement('div');
            item.className = 'online-char-item';
            item.onclick = () => openProfile(char.name);
            item.innerHTML = `
                <img src="${char.avatar}" class="online-char-avatar" alt="${char.name}">
                <div class="online-char-info">
                    <span class="online-char-name" style="color:${char.color||'var(--text-normal)'};">${char.name}</span>
                    <span class="online-char-role">${char.role||''}</span>
                </div>`;
            block.appendChild(item);
        });
        listDiv.appendChild(block);
    });
});
socket.on('force_history_refresh', (data) => { if (currentRoomId === data.roomId && !currentDmTarget) socket.emit('request_history', currentRoomId); });

const txtInput = document.getElementById('txtInput');
txtInput.addEventListener('input', () => {
    if(currentDmTarget) return; 
    const name = currentSelectedChar ? currentSelectedChar.name : "Quelqu'un";
    socket.emit('typing_start', { roomId: currentRoomId, charName: name });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { socket.emit('typing_stop', { roomId: currentRoomId, charName: name }); }, 1000);
});
socket.on('display_typing', (data) => { if(data.roomId === currentRoomId && !currentDmTarget) { document.getElementById('typing-indicator').classList.remove('hidden'); document.getElementById('typing-text').textContent = `${data.charName} écrit...`; } });
socket.on('hide_typing', (data) => { if(data.roomId === currentRoomId) document.getElementById('typing-indicator').classList.add('hidden'); });

function createRoomPrompt() { const name = prompt("Nom du salon :"); if (name) socket.emit('create_room', { name, creatorId: PLAYER_ID, allowedCharacters: [] }); }
function deleteRoom(roomId) { if(confirm("ADMIN : Supprimer ?")) socket.emit('delete_room', roomId); }
function joinRoom(roomId) {
    if (allRooms.length > 0 && roomId !== 'global' && !allRooms.find(r => r._id === roomId)) roomId = 'global';
    if (currentRoomId && currentRoomId !== roomId) socket.emit('leave_room', currentRoomId);
    currentRoomId = roomId; lastMessageData = { author: null, time: 0 }; 
    localStorage.setItem('saved_room_id', roomId); currentDmTarget = null; socket.emit('join_room', currentRoomId);
    if (unreadRooms.has(currentRoomId)) unreadRooms.delete(currentRoomId);
    const room = allRooms.find(r => r._id === roomId);
    document.getElementById('currentRoomName').textContent = room ? room.name : 'Salon Global';
    document.getElementById('currentRoomName').style.color = "var(--text-primary)";
    document.getElementById('messages').innerHTML = ""; document.getElementById('typing-indicator').classList.add('hidden');
    document.getElementById('char-selector-wrapper').classList.remove('hidden'); document.getElementById('dm-header-actions').classList.add('hidden');
    socket.emit('request_history', currentRoomId); cancelContext(); clearStaging();
    if(window.innerWidth <= 768) { document.getElementById('sidebar').classList.remove('open'); document.getElementById('mobile-overlay').classList.remove('open'); }
    updateRoomListUI(); updateDmListUI(); switchView('chat'); 
}
socket.on('rooms_data', (rooms) => { allRooms = rooms; updateRoomListUI(); });
socket.on('force_room_exit', (roomId) => { if(currentRoomId === roomId) joinRoom('global'); });
function updateRoomListUI() {
    const list = document.getElementById('roomList');
    list.innerHTML = `<div class="room-item ${(currentRoomId === 'global' && !currentDmTarget)?'active':''} ${unreadRooms.has('global')?'unread':''}" onclick="joinRoom('global')"><span class="room-name">Salon Global</span></div>`;
    allRooms.forEach(room => {
        const delBtn = IS_ADMIN ? `<button class="btn-del-room" onclick="event.stopPropagation(); deleteRoom('${room._id}')"><i class="fa-solid fa-trash"></i></button>` : '';
        const isUnread = unreadRooms.has(String(room._id)) ? 'unread' : '';
        const isActive = (String(currentRoomId) === String(room._id) && !currentDmTarget) ? 'active' : '';
        list.innerHTML += `<div class="room-item ${isActive} ${isUnread}" onclick="joinRoom('${room._id}')"><span class="room-name">${room.name}</span>${delBtn}</div>`;
    });
}

function startDmFromList(target) { if (target !== USERNAME) openDm(target); }
socket.on('open_dm_ui', (target) => openDm(target));
function openDm(target) {
    currentDmTarget = target; currentRoomId = null; lastMessageData = { author: null, time: 0 }; 
    if (!dmContacts.includes(target)) dmContacts.push(target);
    if (unreadDms.has(target)) unreadDms.delete(target);
    document.getElementById('currentRoomName').textContent = `@${target}`; document.getElementById('currentRoomName').style.color = "#9b59b6"; 
    document.getElementById('messages').innerHTML = ""; document.getElementById('char-selector-wrapper').classList.add('hidden'); document.getElementById('dm-header-actions').classList.remove('hidden'); 
    cancelContext(); clearStaging(); socket.emit('request_dm_history', { myUsername: USERNAME, targetUsername: target });
    updateRoomListUI(); updateDmListUI(); switchView('chat'); 
    if(window.innerWidth <= 768) { document.getElementById('sidebar').classList.remove('open'); document.getElementById('mobile-overlay').classList.remove('open'); }
}
function closeCurrentDm() { if(currentDmTarget) { dmContacts = dmContacts.filter(c => c !== currentDmTarget); joinRoom('global'); } }
function deleteCurrentDmHistory() { if(currentDmTarget && confirm("Supprimer histo ?")) socket.emit('delete_dm_history', { myUsername: USERNAME, targetUsername: currentDmTarget }); }
socket.on('dm_history_deleted', (target) => { if(currentDmTarget === target) document.getElementById('messages').innerHTML = "<i>Historique supprimé.</i>"; });
socket.on('dm_contacts_data', (contacts) => { dmContacts = contacts; updateDmListUI(); });
function updateDmListUI() {
    const list = document.getElementById('dmList'); list.innerHTML = "";
    dmContacts.forEach(contact => {
        const isActive = (currentDmTarget === contact) ? 'active' : '';
        const isUnread = unreadDms.has(contact) ? 'unread' : '';
        const avatarUrl = `https://ui-avatars.com/api/?name=${contact}&background=random&color=fff&size=64`;
        list.innerHTML += `<div class="dm-item ${isActive} ${isUnread}" onclick="openDm('${contact}')"><img src="${avatarUrl}" class="dm-avatar"><span>${contact}</span></div>`;
    });
}
socket.on('dm_history_data', (data) => { if (currentDmTarget === data.target) { document.getElementById('messages').innerHTML=""; lastMessageData={author:null, time:0}; data.history.forEach(msg => displayMessage(msg, true)); scrollToBottom(); } });
socket.on('receive_dm', (msg) => {
    const other = (msg.sender === USERNAME) ? msg.target : msg.sender;
    if (!dmContacts.includes(other)) { dmContacts.push(other); updateDmListUI(); }
    if (currentDmTarget === other) { displayMessage(msg, true); scrollToBottom(); } 
    else { unreadDms.add(other); updateDmListUI(); }
    if (msg.sender !== USERNAME && notificationsEnabled) notifSound.play().catch(e=>{});
});

async function createCharacter() {
    if (myCharacters.length >= 20) return alert("Limite 20 persos.");
    const name = document.getElementById('newCharName').value.trim();
    const role = document.getElementById('newCharRole').value.trim();
    const partyName = document.getElementById('newCharPartyName').value.trim();
    const fileInput = document.getElementById('newCharFile');
    const partyFileInput = document.getElementById('newCharPartyFile');
    const capitalEl = document.getElementById('newCharCapital');
    const capital = capitalEl ? (parseFloat(capitalEl.value) || 0) : 0;
    const partyFounder = document.getElementById('newCharPartyFounder')?.value.trim() || '';
    const partyCreationDate = document.getElementById('newCharPartyCreationDate')?.value.trim() || '';
    const partyMotto = document.getElementById('newCharPartyMotto')?.value.trim() || '';
    const partyDescription = document.getElementById('newCharPartyDescription')?.value.trim() || '';
    
    let avatar = fileInput.files[0] ? await uploadToCloudinary(fileInput.files[0]) : `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;
    let partyLogo = partyFileInput.files[0] ? await uploadToCloudinary(partyFileInput.files[0]) : null;
    if(!name || !role) return alert("Nom et rôle requis.");
    
    const isOfficial = role.includes('Journaliste') || role.includes('Gouvernement') || role.includes('Presse');
    socket.emit('create_char', { 
        name, role, 
        color: document.getElementById('newCharColor').value, 
        avatar, 
        description: document.getElementById('newCharDesc').value.trim(), 
        ownerId: PLAYER_ID, 
        partyName: partyName || null, 
        partyLogo: partyLogo || null,
        partyFounder: partyFounder || null,
        partyCreationDate: partyCreationDate || null,
        partyMotto: partyMotto || null,
        partyDescription: partyDescription || null,
        isOfficial,
        companies: newCharCompanies || [],
        capital
    });
    toggleCreateForm();
    fileInput.value = ""; partyFileInput.value = "";
    document.getElementById('newCharPartyName').value = "";
    if(document.getElementById('newCharPartyFounder')) document.getElementById('newCharPartyFounder').value = '';
    if(document.getElementById('newCharPartyCreationDate')) document.getElementById('newCharPartyCreationDate').value = '';
    if(document.getElementById('newCharPartyMotto')) document.getElementById('newCharPartyMotto').value = '';
    if(document.getElementById('newCharPartyDescription')) document.getElementById('newCharPartyDescription').value = '';
    if(capitalEl) capitalEl.value = '';
    newCharCompanies = [];
    renderNewCharCompanies();
}
function prepareEditCharacter(id) {
    const char = myCharacters.find(c => c._id === id); if (!char) return;
    document.getElementById('editCharId').value = char._id;
    document.getElementById('editCharOriginalName').value = char.name;
    document.getElementById('editCharName').value = char.name;
    document.getElementById('editCharRole').value = char.role;
    document.getElementById('editCharDesc').value = char.description || '';
    document.getElementById('editCharColor').value = char.color || '#5c7cfa';
    document.getElementById('editCharBase64').value = char.avatar;
    document.getElementById('editCharPartyName').value = char.partyName || '';
    document.getElementById('editCharPartyBase64').value = char.partyLogo || '';
    document.getElementById('editCharCapital').value = char.capital || 0;
    if(document.getElementById('editCharPartyFounder')) document.getElementById('editCharPartyFounder').value = char.partyFounder || '';
    if(document.getElementById('editCharPartyCreationDate')) document.getElementById('editCharPartyCreationDate').value = char.partyCreationDate || '';
    if(document.getElementById('editCharPartyMotto')) document.getElementById('editCharPartyMotto').value = char.partyMotto || '';
    if(document.getElementById('editCharPartyDescription')) document.getElementById('editCharPartyDescription').value = char.partyDescription || '';
    // Charger les entreprises existantes
    editCharCompanies = (char.companies || []).map(c => ({...c}));
    renderEditCharCompanies();
    openCharModal('edit');
}
function cancelEditCharacter() { closeCharModal(); }
async function submitEditCharacter() {
    const file = document.getElementById('editCharFile').files[0];
    const partyFile = document.getElementById('editCharPartyFile').files[0];
    let newAvatar = document.getElementById('editCharBase64').value;
    let newPartyLogo = document.getElementById('editCharPartyBase64').value;
    const newPartyName = document.getElementById('editCharPartyName').value.trim();
    const newCapital = parseFloat(document.getElementById('editCharCapital').value) || 0;
    if (file) { const url = await uploadToCloudinary(file); if (url) newAvatar = url; }
    if (partyFile) { const url = await uploadToCloudinary(partyFile); if (url) newPartyLogo = url; }
    const newRole = document.getElementById('editCharRole').value.trim();
    const isOfficial = newRole.includes('Journaliste') || newRole.includes('Gouvernement') || newRole.includes('Presse');
    socket.emit('edit_char', {
        charId: document.getElementById('editCharId').value,
        originalName: document.getElementById('editCharOriginalName').value,
        newName: document.getElementById('editCharName').value.trim(),
        newRole, newAvatar,
        newColor: document.getElementById('editCharColor').value,
        newDescription: document.getElementById('editCharDesc').value.trim(),
        ownerId: PLAYER_ID, currentRoomId,
        partyName: newPartyName || null,
        partyLogo: newPartyLogo || null,
        partyFounder: document.getElementById('editCharPartyFounder')?.value.trim() || null,
        partyCreationDate: document.getElementById('editCharPartyCreationDate')?.value.trim() || null,
        partyMotto: document.getElementById('editCharPartyMotto')?.value.trim() || null,
        partyDescription: document.getElementById('editCharPartyDescription')?.value.trim() || null,
        isOfficial,
        capital: newCapital,
        companies: editCharCompanies
    });
    closeCharModal();
    document.getElementById('editCharFile').value = '';
    document.getElementById('editCharPartyFile').value = '';
}
socket.on('my_chars_data', (chars) => { 
    myCharacters = chars; updateUI(); 
    const saved = localStorage.getItem('saved_char_id');
    if (saved && myCharacters.find(c => c._id === saved)) selectCharacter(saved);
    else if (IS_ADMIN && saved === 'narrateur') selectCharacter('narrateur');
});
socket.on('char_created_success', (char) => { myCharacters.push(char); updateUI(); closeCharModal(); });
function deleteCharacter(id) { if(confirm('Supprimer ?')) socket.emit('delete_char', id); }
socket.on('char_deleted_success', (id) => { myCharacters = myCharacters.filter(c => c._id !== id); updateUI(); });
socket.on('char_updated', (char) => {
    const idx = myCharacters.findIndex(c => String(c._id) === String(char._id));
    if(idx >= 0) {
        Object.assign(myCharacters[idx], char);
        if(currentView === 'mes-persos') renderMesPersos();
        if(currentView === 'accueil') renderAccueil();
    }
    if(currentProfileChar && String(currentProfileChar._id) === String(char._id)) {
        Object.assign(currentProfileChar, char);
    }
});

function selectCharacter(id) {
    const narrateur = { _id: 'narrateur', name: 'Narrateur', role: 'Omniscient', color: '#ffffff', avatar: 'https://cdn-icons-png.flaticon.com/512/1144/1144760.png' };
    currentSelectedChar = (id === 'narrateur') ? narrateur : myCharacters.find(c => c._id === id);
    if(currentSelectedChar) localStorage.setItem('saved_char_id', currentSelectedChar._id);
    document.querySelectorAll('.avatar-choice').forEach(el => el.classList.remove('selected'));
    const el = document.getElementById(`avatar-opt-${id}`); if(el) el.classList.add('selected');
}
function toggleCharBar() {
    const bar = document.getElementById('char-bar-horizontal'); const icon = document.getElementById('toggle-icon');
    bar.classList.toggle('hidden-bar');
    if (bar.classList.contains('hidden-bar')) { icon.classList.remove('fa-chevron-down'); icon.classList.add('fa-chevron-up'); } 
    else { icon.classList.remove('fa-chevron-up'); icon.classList.add('fa-chevron-down'); }
}

function updateUI() {
    const list = document.getElementById('myCharList'); const bar = document.getElementById('char-bar-horizontal');
    list.innerHTML = ""; bar.innerHTML = "";
    if(IS_ADMIN) bar.innerHTML += `<img src="https://cdn-icons-png.flaticon.com/512/1144/1144760.png" id="avatar-opt-narrateur" class="avatar-choice" title="Narrateur" onclick="selectCharacter('narrateur')">`;

    myCharacters.forEach((char, index) => {
        list.innerHTML += `<div class="char-item"><img src="${char.avatar}" class="mini-avatar"><div class="char-info"><div class="char-name-list" style="color:${char.color}">${char.name}</div><div class="char-role-list">${char.role}</div></div><div class="char-actions"><button class="btn-mini-action" onclick="prepareEditCharacter('${char._id}')"><i class="fa-solid fa-gear"></i></button><button class="btn-mini-action" onclick="deleteCharacter('${char._id}')" style="color:#da373c;"><i class="fa-solid fa-trash"></i></button></div></div>`;
        bar.innerHTML += `<img src="${char.avatar}" id="avatar-opt-${char._id}" class="avatar-choice" title="${char.name}" onclick="selectCharacter('${char._id}')">`;
        if (index === 0 && !currentFeedCharId) currentFeedCharId = char._id;
    });

    if (!currentSelectedChar) { if(myCharacters.length > 0) selectCharacter(myCharacters[0]._id); else if(IS_ADMIN) selectCharacter('narrateur'); }
    else selectCharacter(currentSelectedChar._id);

    updateFeedCharUI(); updatePresseCharUI(); updateBreakingNewsVisibility();
    if(currentView === 'mes-persos') renderMesPersos();
    if(currentView === 'accueil') renderAccueil();
}

// FEED AVATAR SELECTOR
function updateFeedCharUI() {
    const container = document.getElementById('feed-char-avatar-wrapper'); if(!container) return;
    const char = currentFeedCharId ? myCharacters.find(c => c._id === currentFeedCharId) : null;
    const avatarSrc = char ? char.avatar : 'https://cdn-icons-png.flaticon.com/512/1144/1144760.png';
    container.innerHTML = `
        <div class="feed-char-trigger" onclick="toggleFeedCharDropdown()" title="Changer de personnage pour le Feed">
            <img src="${avatarSrc}" class="feed-char-avatar-btn" id="feed-active-avatar">
            <i class="fa-solid fa-chevron-down feed-char-chevron"></i>
        </div>
        <div id="feed-char-dropdown" class="feed-char-dropdown hidden">
            ${myCharacters.map(c => `
                <div class="feed-char-option ${c._id === currentFeedCharId ? 'active' : ''}" onclick="selectFeedChar('${c._id}')">
                    <img src="${c.avatar}" class="feed-char-opt-avatar">
                    <div><div class="feed-char-opt-name" style="color:${c.color}">${c.name}</div><div class="feed-char-opt-role">${c.role}</div></div>
                    ${c._id === currentFeedCharId ? '<i class="fa-solid fa-check" style="margin-left:auto; color:var(--accent);"></i>' : ''}
                </div>`).join('')}
        </div>`;
}

function toggleFeedCharDropdown() { const dd = document.getElementById('feed-char-dropdown'); if(dd) dd.classList.toggle('hidden'); }
function selectFeedChar(charId) {
    currentFeedCharId = charId;
    const dd = document.getElementById('feed-char-dropdown'); if(dd) dd.classList.add('hidden');
    updateFeedCharUI(); updateBreakingNewsVisibility(); loadFeed();
}

// PRESSE CHAR SELECTOR
function updatePresseCharUI() {
    const container = document.getElementById('presse-char-avatar-wrapper'); if(!container) return;
    const journalistChars = myCharacters.filter(c => c.role && (c.role.toLowerCase().includes('journaliste') || c.isOfficial));
    if(!currentPresseCharId && journalistChars.length > 0) currentPresseCharId = journalistChars[0]._id;
    const char = currentPresseCharId ? myCharacters.find(c => c._id === currentPresseCharId) : null;
    const avatarSrc = char ? char.avatar : 'https://cdn-icons-png.flaticon.com/512/1144/1144760.png';
    container.innerHTML = `
        <div class="feed-char-trigger" onclick="togglePresseCharDropdown()" title="Changer de journaliste">
            <img src="${avatarSrc}" class="feed-char-avatar-btn">
            <i class="fa-solid fa-chevron-down feed-char-chevron"></i>
        </div>
        <div id="presse-char-dropdown" class="feed-char-dropdown hidden">
            ${journalistChars.length === 0 ? '<div style="padding:12px; color:#777; font-size:0.82rem;">Aucun journaliste</div>' : journalistChars.map(c => `
                <div class="feed-char-option ${c._id === currentPresseCharId ? 'active' : ''}" onclick="selectPresseChar('${c._id}')">
                    <img src="${c.avatar}" class="feed-char-opt-avatar">
                    <div><div class="feed-char-opt-name" style="color:${c.color}">${c.name}</div><div class="feed-char-opt-role">${c.role}</div></div>
                    ${c._id === currentPresseCharId ? '<i class="fa-solid fa-check" style="margin-left:auto; color:var(--accent);"></i>' : ''}
                </div>`).join('')}
        </div>`;
    // Afficher ou masquer la zone de rédaction
    updatePresseWriteBox();
}
function togglePresseCharDropdown() { const dd = document.getElementById('presse-char-dropdown'); if(dd) dd.classList.toggle('hidden'); }
function selectPresseChar(charId) {
    currentPresseCharId = charId;
    const dd = document.getElementById('presse-char-dropdown'); if(dd) dd.classList.add('hidden');
    updatePresseCharUI();
}
function updatePresseWriteBox() {
    const writeBox = document.getElementById('presse-write-box');
    const notice = document.getElementById('presse-no-journalist');
    if(!writeBox || !notice) return;
    const char = currentPresseCharId ? myCharacters.find(c => c._id === currentPresseCharId) : null;
    const isJournalist = char && (char.role && (char.role.toLowerCase().includes('journaliste') || char.isOfficial));
    if(isJournalist) { writeBox.classList.remove('hidden'); notice.classList.add('hidden'); }
    else { writeBox.classList.add('hidden'); notice.classList.remove('hidden'); }
}

function updateBreakingNewsVisibility() {
    const label = document.getElementById('breakingNewsLabel'); if(!label) return;
    const char = myCharacters.find(c => c._id === currentFeedCharId);
    if(char && char.isOfficial) { label.style.display = 'flex'; } else { label.style.display = 'none'; document.getElementById('postBreakingNews').checked = false; }
}

// ==================== PROFILE PLEIN ÉCRAN ====================
// [NOUVEAU] State profil courant
let currentProfileChar = null;

function openProfile(name) {
    currentProfileChar = null;
    ['profileName','profileRole','profileDesc','profileOwner'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = ''; });
    ['profileFollowersCount','profilePostCount'].forEach(id => { const el = document.getElementById(id); if(el) el.textContent = '0'; });
    const av = document.getElementById('profileAvatar'); if(av) av.src = '';
    const pb = document.getElementById('profilePartyBadge'); if(pb) pb.style.display = 'none';
    const af = document.getElementById('profileActivityFeed'); if(af) af.innerHTML = '<div style="padding:8px 0;color:var(--text-muted);font-size:0.82rem;">Chargement...</div>';
    const cg = document.getElementById('profileCompaniesGrid'); if(cg) cg.innerHTML = '';
    const cs = document.getElementById('profileCompaniesSection'); if(cs) cs.style.display = 'none';
    closeBioEdit();
    const overlay = document.getElementById('profile-overlay');
    overlay.classList.remove('hidden');
    overlay.onclick = closeProfileModal; // cliquer dans le vide ferme le profil
    document.getElementById('profile-slide-panel').classList.add('open');
    socket.emit('get_char_profile', name);
}
function closeProfileModal() { 
    document.getElementById('profile-slide-panel').classList.remove('open'); 
    document.getElementById('profile-overlay').classList.add('hidden');
    currentProfileChar = null;
}
function editMyCharFromProfile() {
    if(!currentProfileChar) return;
    const char = myCharacters.find(c => c._id === currentProfileChar._id);
    if(!char) return;
    closeProfileModal();
    prepareEditCharacter(char._id);
}

socket.on('char_profile_data', (char) => {
    currentProfileChar = char;

    // En-tête héro
    document.getElementById('profileName').textContent = char.name;
    document.getElementById('profileRole').textContent = char.role;
    document.getElementById('profileAvatar').src = char.avatar;

    // Fond héro avec couleur du perso
    const heroBg = document.getElementById('profileHeroBg');
    if(heroBg) heroBg.style.background = `linear-gradient(135deg, ${char.color || 'var(--accent)'}33 0%, var(--bg-secondary) 100%)`;

    // Parti dans header
    const partyBadgeEl = document.getElementById('profilePartyBadge');
    if(char.partyName) {
        partyBadgeEl.style.display = 'block';
        partyBadgeEl.innerHTML = char.partyLogo 
            ? `<span class="profile-party-tag"><img src="${char.partyLogo}" class="party-logo" style="width:18px;height:18px;"> ${char.partyName}</span>`
            : `<span class="profile-party-tag">🏛️ ${char.partyName}</span>`;
    } else {
        partyBadgeEl.style.display = 'none';
    }

    // Stats
    const followersCount = char.followers ? char.followers.length : 0;
    document.getElementById('profileFollowersCount').textContent = followersCount;
    document.getElementById('profilePostCount').textContent = char.postCount || 0;

    // Admin edit followers
    const adminFollowersBtn = document.getElementById('adminEditFollowers');
    if(adminFollowersBtn) { 
        if(IS_ADMIN) adminFollowersBtn.classList.remove('hidden'); 
        else adminFollowersBtn.classList.add('hidden'); 
    }

    // Voir abonnés
    document.getElementById('btn-view-followers').onclick = () => socket.emit('get_followers_list', char._id);

    // Bio
    setBioWithVoirPlus('profileDesc', char.description || '');
    document.getElementById('profileOwner').textContent = `Joué par : ${char.ownerUsername || "Inconnu"}`;
    if(char.partyName && char.partyLogo) {
        document.getElementById('profileOwner').innerHTML += ` <span class="party-badge" style="display:inline-flex;"><img src="${char.partyLogo}" class="party-logo"> ${char.partyName}</span>`;
    }

    // [CITÉS] Badge "Président de X" si ce perso est président d'une cité
    const presidedCity = citiesData.find(c => c.president && c.president.toLowerCase() === char.name.toLowerCase());
    const presidentBadgeEl = document.getElementById('profilePresidentBadge');
    if(presidedCity && presidentBadgeEl) {
        presidentBadgeEl.innerHTML = `<span class="president-badge"><i class="fa-solid fa-landmark"></i> Président de ${presidedCity.name}</span>`;
        presidentBadgeEl.style.display = 'block';
    } else if(presidentBadgeEl) {
        presidentBadgeEl.style.display = 'none';
        presidentBadgeEl.innerHTML = '';
    }

    // [NOUVEAU] Bouton modifier bio — visible seulement si c'est un de nos persos
    const btnEditBio = document.getElementById('btn-edit-bio');
    const isOwnChar = myCharacters.some(c => c._id === char._id);
    if(btnEditBio) {
        if(isOwnChar) { btnEditBio.classList.remove('hidden'); }
        else { btnEditBio.classList.add('hidden'); closeBioEdit(); }
    }

    // Bouton modifier personnage — visible seulement si c'est un de nos persos
    const btnEditMyChar = document.getElementById('btn-edit-my-char');
    if(btnEditMyChar) {
        if(isOwnChar) { btnEditMyChar.classList.remove('hidden'); }
        else { btnEditMyChar.classList.add('hidden'); }
    }

    // Bouton DM compte
    const btnDm = document.getElementById('btn-dm-profile');
    btnDm.onclick = function() { closeProfileModal(); if(char.ownerUsername) openDm(char.ownerUsername); };

    // [NOUVEAU] Bouton DM Personnage — visible si on a des persos et que c'est pas nous
    const btnCharDm = document.getElementById('btn-char-dm-profile');
    if(myCharacters.length > 0 && !isOwnChar && PLAYER_ID) {
        btnCharDm.classList.remove('hidden');
        btnCharDm.onclick = () => openCharDmModal(char);
    } else {
        btnCharDm.classList.add('hidden');
    }

    // Bouton suivre
    const btnSub = document.getElementById('btn-sub-profile');
    if(isOwnChar || currentFeedCharId === char._id) { btnSub.style.display = 'none'; }
    else {
        btnSub.style.display = 'block';
        const isSubbed = char.followers && currentFeedCharId && char.followers.includes(currentFeedCharId);
        updateSubButton(btnSub, isSubbed);
        btnSub.onclick = function() {
            if(!currentFeedCharId) return alert("Sélectionnez un personnage dans le Feed !");
            socket.emit('follow_character', { followerCharId: currentFeedCharId, targetCharId: char._id });
        };
    }

    // [NOUVEAU] Bouton admin entreprises
    const btnCompanies = document.getElementById('btn-manage-companies');
    if(IS_ADMIN && !isOwnChar) { btnCompanies.classList.remove('hidden'); }
    else { btnCompanies.classList.add('hidden'); }

    // [NOUVEAU] Section Entreprises
    const companiesSection = document.getElementById('profileCompaniesSection');
    const companiesGrid = document.getElementById('profileCompaniesGrid');
    if(char.companies && char.companies.length > 0) {
        companiesSection.style.display = 'block';
        companiesGrid.innerHTML = '';
        char.companies.forEach((co, idx) => {
            const delBtn = IS_ADMIN ? `<button class="company-card-del" onclick="adminRemoveCompany('${char._id}', ${idx})" title="Retirer"><i class="fa-solid fa-xmark"></i></button>` : '';
            companiesGrid.innerHTML += `
                <div class="company-card">
                    ${delBtn}
                    <div class="company-card-logo">${co.logo ? `<img src="${co.logo}" alt="${co.name}">` : `<i class="fa-solid fa-building"></i>`}</div>
                    <div class="company-card-name">${co.name}</div>
                    <div class="company-card-role">${co.role || ''}</div>
                    ${co.description ? `<div class="company-card-desc">${co.description}</div>` : ''}
                </div>`;
        });
    } else {
        companiesSection.style.display = IS_ADMIN ? 'block' : 'none';
        if(IS_ADMIN) companiesGrid.innerHTML = '<div style="color:var(--text-muted); font-size:0.82rem; font-style:italic;">Aucune entreprise. Cliquez sur "Entreprises" pour en ajouter.</div>';
    }

    // [NOUVEAU] Section Activité (derniers posts)
    const activityFeed = document.getElementById('profileActivityFeed');
    activityFeed.innerHTML = '';
    if(char.lastPosts && char.lastPosts.length > 0) {
        char.lastPosts.forEach(post => {
            const mini = document.createElement('div');
            mini.className = 'profile-mini-post';
            mini.innerHTML = `
                <div class="profile-mini-post-content">${formatText(post.content || '')}</div>
                <div class="profile-mini-post-meta">
                    <span><i class="fa-solid fa-heart" style="color:var(--danger);"></i> ${post.likes ? post.likes.length : 0}</span>
                    <span style="color:var(--text-muted);">${post.date || ''}</span>
                    ${IS_ADMIN ? `<button class="admin-stat-btn" onclick="openAdminStatsModal('${post._id}', ${post.likes ? post.likes.length : 0})"><i class="fa-solid fa-pen"></i></button>` : ''}
                </div>`;
            activityFeed.appendChild(mini);
        });
    } else {
        activityFeed.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; font-style:italic; padding:10px 0;">Aucun post récent.</div>';
    }
});

socket.on('char_profile_updated', (char) => { 
    if(document.getElementById('profile-slide-panel').classList.contains('open') && document.getElementById('profileName').textContent === char.name) {
        const isSubbed = char.followers && currentFeedCharId && char.followers.includes(currentFeedCharId);
        updateSubButton(document.getElementById('btn-sub-profile'), isSubbed); 
        document.getElementById('profileFollowersCount').textContent = `${char.followers.length}`;
    }
});
function updateSubButton(btn, subbed) { btn.innerHTML = subbed ? '<i class="fa-solid fa-check"></i> Abonné' : '<i class="fa-solid fa-rss"></i> S\'abonner'; btn.style.color = subbed ? '#23a559' : 'white'; }

// [NOUVEAU] Modifier bio
function openBioEdit() {
    document.getElementById('bio-edit-zone').classList.remove('hidden');
    document.getElementById('btn-edit-bio').classList.add('hidden');
    document.getElementById('bioEditInput').value = currentProfileChar ? (currentProfileChar.description || '') : '';
}
function closeBioEdit() {
    document.getElementById('bio-edit-zone').classList.add('hidden');
    const btn = document.getElementById('btn-edit-bio');
    const isOwnChar = currentProfileChar && myCharacters.some(c => c._id === currentProfileChar._id);
    if(btn && isOwnChar) btn.classList.remove('hidden');
}
function saveBio() {
    if(!currentProfileChar) return;
    const bio = document.getElementById('bioEditInput').value.trim();
    socket.emit('update_char_bio', { charId: currentProfileChar._id, bio, ownerId: PLAYER_ID });
    setBioWithVoirPlus('profileDesc', bio);
    closeBioEdit();
}

// [NOUVEAU] Admin — modale entreprise
function openCompanyModal() {
    if(!currentProfileChar) return;
    const list = document.getElementById('company-existing-list');
    list.innerHTML = '';
    if(currentProfileChar.companies && currentProfileChar.companies.length > 0) {
        currentProfileChar.companies.forEach((co, idx) => {
            const revenueHTML = IS_ADMIN
                ? `<span style="font-size:0.7rem;color:var(--accent-soft);margin-right:4px;">${(co.revenue||0)>0 ? formatStockValue(co.revenue)+' CA' : 'CA: —'}</span><button onclick="adminSetCompanyRevenue('${currentProfileChar._id}','${co.name.replace(/'/g,"&apos;")}',${co.revenue||0})" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.85rem;" title="Modifier CA"><i class="fa-solid fa-coins"></i></button>`
                : `${(co.revenue||0)>0 ? `<span style="font-size:0.7rem;color:var(--accent-soft);">${formatStockValue(co.revenue)} CA</span>` : ''}`;
            list.innerHTML += `<div style="display:flex; align-items:center; gap:8px; padding:8px; background:var(--bg-primary); border-radius:var(--radius-sm); margin-bottom:6px;">
                ${co.logo ? `<img src="${co.logo}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">` : '<i class="fa-solid fa-building" style="color:var(--text-muted);"></i>'}
                <span style="flex:1; font-weight:600;">${co.name}</span>
                ${revenueHTML}
                <span style="font-size:0.75rem; color:var(--text-muted);">${co.role}</span>
                <button onclick="adminRemoveCompany('${currentProfileChar._id}', ${idx}); closeCompanyModal();" style="background:none;border:none;color:var(--danger);cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
            </div>`;
        });
    } else {
        list.innerHTML = '<div style="color:var(--text-muted); font-size:0.82rem; margin-bottom:8px;">Aucune entreprise associée.</div>';
    }
    document.getElementById('company-modal').classList.remove('hidden');
}
function closeCompanyModal() { document.getElementById('company-modal').classList.add('hidden'); }

async function submitAddCompany() {
    if(!currentProfileChar || !IS_ADMIN) return;
    const name = document.getElementById('companyName').value.trim();
    const role = document.getElementById('companyRole').value.trim();
    const desc = document.getElementById('companyDesc').value.trim();
    const hq   = document.getElementById('companyHQ')?.value.trim() || null;
    const rev  = parseFloat(document.getElementById('companyRevenue')?.value) || 0;
    const logoFile = document.getElementById('companyLogoFile').files[0];
    if(!name) return alert("Nom de l'entreprise requis.");
    let logo = null;
    if(logoFile) logo = await uploadToCloudinary(logoFile);
    socket.emit('admin_add_company', { charId: currentProfileChar._id, company: { name, logo, role, description: desc, headquarters: hq, revenue: rev } });
    document.getElementById('companyName').value = '';
    document.getElementById('companyRole').value = '';
    document.getElementById('companyDesc').value = '';
    if(document.getElementById('companyHQ')) document.getElementById('companyHQ').value = '';
    if(document.getElementById('companyRevenue')) document.getElementById('companyRevenue').value = '';
    document.getElementById('companyLogoFile').value = '';
    closeCompanyModal();
}
function adminRemoveCompany(charId, idx) {
    if(!IS_ADMIN) return;
    if(confirm('Retirer cette entreprise ?')) socket.emit('admin_remove_company', { charId, companyIndex: idx });
}

// [NOUVEAU] Admin — modifier stats abonnés
function adminEditFollowers() {
    if(!currentProfileChar || !IS_ADMIN) return;
    const count = prompt(`Nombre d'abonnés actuel : ${currentProfileChar.followers ? currentProfileChar.followers.length : 0}\nNouveau nombre :`, currentProfileChar.followers ? currentProfileChar.followers.length : 0);
    if(count !== null && !isNaN(parseInt(count))) {
        socket.emit('admin_edit_followers', { charId: currentProfileChar._id, count: parseInt(count) });
    }
}

// [NOUVEAU] Admin — modale stats post (likes)
function openAdminStatsModal(postId, currentLikes) {
    document.getElementById('adminStatsPostId').value = postId;
    document.getElementById('adminStatsLikes').value = currentLikes;
    document.getElementById('admin-stats-modal').classList.remove('hidden');
}
function closeAdminStatsModal() { document.getElementById('admin-stats-modal').classList.add('hidden'); }
function submitAdminStats() {
    const postId = document.getElementById('adminStatsPostId').value;
    const likes = parseInt(document.getElementById('adminStatsLikes').value) || 0;
    socket.emit('admin_edit_post_likes', { postId, count: likes });
    closeAdminStatsModal();
}

// ==================== MP PERSONNAGES (Refonte claire) ====================
/*
  Clé de conv : "monCharId|autreCharId"
  Chaque conversation est liée à UN de MES persos ↔ UN perso cible.
  La sidebar groupe les convos par MON perso pour une clarté totale.
*/

let charDmTarget = null;
let charMpConversations = {}; // { "myCharId|otherCharId": { myChar, otherChar, msgs[], unread, lastContent } }
let charMpCurrentKey    = null;

function mpKey(a, b)  { return `${a}|${b}`; }
function mpParse(key) { const [a, b] = key.split('|'); return { myCharId: a, otherCharId: b }; }

// ── Charger toutes les convos existantes depuis le serveur ──
function loadMyCharConvos() {
    const ids = myCharacters.map(c => c._id);
    if(!ids.length) return;
    socket.emit('request_my_char_convos', { myCharIds: ids });
}

socket.on('my_char_convos', (convos) => {
    convos.forEach(c => {
        const myChar = myCharacters.find(ch => String(ch._id) === String(c.myCharId));
        if(!myChar) return;
        const key = mpKey(c.myCharId, c.otherCharId);
        if(!charMpConversations[key]) {
            charMpConversations[key] = {
                myChar,
                otherChar: { _id: c.otherCharId, name: c.otherName, avatar: c.otherAvatar||'', color: c.otherColor||'', role: c.otherRole||'', ownerId: c.otherOwnerId||'' },
                msgs: [], unread: false, lastContent: c.lastContent || ''
            };
        }
    });
    renderCharMpSidebar();
});

// ── Sidebar : grouper par MON perso ──
function renderCharMpSidebar() {
    const list = document.getElementById('char-mp-convo-list');
    if(!list) return;
    list.innerHTML = '';
    const groups = {};
    Object.entries(charMpConversations).forEach(([key, conv]) => {
        const id = conv.myChar._id;
        if(!groups[id]) groups[id] = { myChar: conv.myChar, convos: [] };
        groups[id].convos.push({ key, ...conv });
    });
    if(!Object.keys(groups).length) {
        list.innerHTML = `<div class="char-mp-empty-list"><i class="fa-solid fa-inbox"></i><span>Aucun message</span></div>`;
        return;
    }
    myCharacters.forEach(myChar => {
        const group = groups[myChar._id];
        if(!group) return;
        const groupEl = document.createElement('div');
        groupEl.className = 'char-mp-group';
        const header = document.createElement('div');
        header.className = 'char-mp-group-header';
        header.innerHTML = `
            <img src="${myChar.avatar||''}" class="char-mp-group-avatar" onerror="this.style.opacity=0">
            <div class="char-mp-group-info">
                <span class="char-mp-group-name" style="color:${myChar.color||'white'};">${myChar.name}</span>
                <span class="char-mp-group-role">${myChar.role||''}</span>
            </div>`;
        groupEl.appendChild(header);
        const convList = document.createElement('div');
        convList.className = 'char-mp-group-convos';
        group.convos.forEach(conv => {
            const isActive = charMpCurrentKey === conv.key;
            const item = document.createElement('div');
            item.className = `char-mp-conv-item${isActive ? ' active' : ''}${conv.unread ? ' unread' : ''}`;
            item.onclick = () => openCharMpConvo(conv.key);
            item.innerHTML = `
                <img src="${conv.otherChar.avatar||''}" class="char-mp-conv-avatar" onerror="this.style.opacity=0">
                <div class="char-mp-conv-info">
                    <div class="char-mp-conv-name" style="color:${conv.otherChar.color||'var(--text-normal)'};">${conv.otherChar.name}</div>
                    <div class="char-mp-conv-last">${conv.lastContent ? (conv.lastContent.length>32 ? conv.lastContent.slice(0,32)+'…' : conv.lastContent) : ''}</div>
                </div>
                ${conv.unread ? '<span class="char-mp-unread-dot"></span>' : ''}`;
            convList.appendChild(item);
        });
        groupEl.appendChild(convList);
        list.appendChild(groupEl);
    });
}

// ── Ouvrir une conversation ──
function openCharMpConvo(key) {
    charMpCurrentKey = key;
    const conv = charMpConversations[key];
    if(!conv) return;
    conv.unread = false;
    document.getElementById('char-mp-empty').classList.add('hidden');
    const el = document.getElementById('char-mp-convo');
    el.classList.remove('hidden'); el.style.display = 'flex';
    document.getElementById('mpMySenderAvatar').src  = conv.myChar.avatar||'';
    document.getElementById('mpMySenderName').textContent = conv.myChar.name;
    document.getElementById('mpMySenderRole').textContent = conv.myChar.role||'';
    document.getElementById('mpTargetAvatar').src    = conv.otherChar.avatar||'';
    document.getElementById('mpTargetName').textContent   = conv.otherChar.name;
    document.getElementById('mpTargetRole').textContent   = conv.otherChar.role||'';
    document.getElementById('mpMySenderAvatar').style.borderColor  = conv.myChar.color||'var(--border)';
    document.getElementById('mpTargetAvatar').style.borderColor    = conv.otherChar.color||'var(--border)';
    const inputAv = document.getElementById('mpInputSenderAvatar');
    if(inputAv) { inputAv.src = conv.myChar.avatar||''; inputAv.title = conv.myChar.name; }
    renderCharMpSidebar();
    const { myCharId, otherCharId } = mpParse(key);
    socket.emit('request_char_dm_history', { senderCharId: myCharId, targetCharId: otherCharId });
}

function openProfileFromMp() {
    if(!charMpCurrentKey) return;
    const conv = charMpConversations[charMpCurrentKey];
    if(conv) openProfile(conv.otherChar.name);
}

// ── Envoyer ──
function sendCharMpMessage() {
    if(!charMpCurrentKey || !PLAYER_ID) return;
    const content = document.getElementById('charMpInput').value.trim();
    if(!content) return;
    const conv = charMpConversations[charMpCurrentKey];
    if(!conv) return;
    socket.emit('send_char_dm', {
        senderCharId: conv.myChar._id, senderCharName: conv.myChar.name,
        senderAvatar: conv.myChar.avatar, senderColor: conv.myChar.color, senderRole: conv.myChar.role,
        senderOwnerUsername: USERNAME,
        targetCharId: conv.otherChar._id, targetCharName: conv.otherChar.name,
        targetOwnerId: conv.otherChar.ownerId, targetOwnerUsername: conv.otherChar.ownerUsername||'',
        ownerId: PLAYER_ID, content,
        date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
    });
    document.getElementById('charMpInput').value = '';
}

// ── Afficher un message ──
function appendCharMpMsg(msg) {
    const c = document.getElementById('char-mp-messages');
    if(!c || !charMpCurrentKey) return;
    const { myCharId } = mpParse(charMpCurrentKey);
    const isSelf = String(msg.senderCharId) === String(myCharId);
    const div = document.createElement('div');
    div.className = `cmp-msg ${isSelf ? 'cmp-msg-self' : 'cmp-msg-other'}`;
    div.innerHTML = `
        <img src="${msg.senderAvatar||''}" class="cmp-msg-avatar" title="${escapeHtml(msg.senderName||'')}">
        <div class="cmp-msg-bubble" style="--sender-color:${msg.senderColor||'var(--accent)'};">
            <span class="cmp-msg-name">${escapeHtml(msg.senderName||'')}</span>
            <span class="cmp-msg-text">${formatText(msg.content)}</span>
            <span class="cmp-msg-time">${msg.date||''}</span>
        </div>`;
    c.appendChild(div);
    c.scrollTop = c.scrollHeight;
}

// ── Historique ──
socket.on('char_dm_history', ({ senderCharId, targetCharId, msgs }) => {
    if(currentView === 'char-mp' && charMpCurrentKey) {
        const { myCharId, otherCharId } = mpParse(charMpCurrentKey);
        const match = (String(senderCharId)===String(myCharId) && String(targetCharId)===String(otherCharId))
                   || (String(senderCharId)===String(otherCharId) && String(targetCharId)===String(myCharId));
        if(match) { const c=document.getElementById('char-mp-messages'); if(c){c.innerHTML=''; msgs.forEach(m=>appendCharMpMsg(m));} }
    }
    const modal = document.getElementById('char-dm-modal');
    if(modal && !modal.classList.contains('hidden')) {
        const c = document.getElementById('char-dm-messages');
        if(c) { c.innerHTML=''; msgs.forEach(m=>appendCharDmMsg(m)); c.scrollTop=c.scrollHeight; }
    }
});

// ── Réception nouveau MP ──
socket.on('receive_char_dm', (msg) => {
    const isForMe = msg.targetOwnerId===PLAYER_ID || msg.ownerId===PLAYER_ID;
    if(!isForMe) return;
    const myCharIds = myCharacters.map(c=>String(c._id));
    const isISender  = myCharIds.includes(String(msg.senderCharId));
    const myCharId   = isISender ? String(msg.senderCharId) : String(msg.targetCharId);
    const othCharId  = isISender ? String(msg.targetCharId) : String(msg.senderCharId);
    const key = mpKey(myCharId, othCharId);
    if(!charMpConversations[key]) {
        const myChar = myCharacters.find(c=>String(c._id)===myCharId);
        if(!myChar) return;
        charMpConversations[key] = {
            myChar,
            otherChar: { _id: othCharId, name: isISender?msg.targetName:msg.senderName, avatar: isISender?'':(msg.senderAvatar||''), color: isISender?'':(msg.senderColor||''), role: isISender?'':(msg.senderRole||''), ownerId: isISender?msg.targetOwnerId:msg.ownerId },
            msgs:[], unread:false
        };
    }
    charMpConversations[key].lastContent = msg.content;
    charMpConversations[key].msgs.push(msg);
    if(currentView==='char-mp' && charMpCurrentKey===key) { appendCharMpMsg(msg); }
    else if(msg.ownerId!==PLAYER_ID) {
        charMpConversations[key].unread = true;
        const badge=document.getElementById('char-mp-badge'), btn=document.getElementById('btn-view-char-mp');
        if(badge){badge.classList.remove('hidden');badge.textContent='!';}
        if(btn) btn.classList.add('nav-char-mp-unread');
        renderCharMpSidebar();
    }
    const modal=document.getElementById('char-dm-modal');
    if(charDmTarget && charDmTarget._id===othCharId && modal && !modal.classList.contains('hidden')) {
        appendCharDmMsg(msg); const c=document.getElementById('char-dm-messages'); if(c)c.scrollTop=c.scrollHeight;
    }
    if(notificationsEnabled && msg.ownerId!==PLAYER_ID) notifSound.play().catch(()=>{});
});

// ── Modale nouvelle conversation ──
function openNewConvModal() {
    const sel = document.getElementById('newConvMySender');
    if(sel) sel.innerHTML = myCharacters.map(c=>`<option value="${c._id}">${c.name}</option>`).join('') || '<option value="">— aucun —</option>';
    const inp = document.getElementById('newConvSearch'); if(inp) inp.value='';
    hideCharMpResults();
    document.getElementById('new-conv-modal').classList.remove('hidden');
}
function closeNewConvModal() { document.getElementById('new-conv-modal').classList.add('hidden'); }

function filterCharMpSearch(query) {
    if(!query||query.trim().length<1){ hideCharMpResults(); return; }
    socket.emit('search_chars', { query: query.trim() });
}
function hideCharMpResults() { const r=document.getElementById('newConvResults'); if(r) r.classList.add('hidden'); }

socket.on('chars_search_results', (results) => {
    const box = document.getElementById('newConvResults'); if(!box) return;
    const filtered = results.filter(c => !myCharacters.some(mc=>mc._id===c._id));
    if(!filtered.length) { box.innerHTML='<div class="char-mp-search-item" style="color:var(--text-muted);font-style:italic;padding:10px;">Aucun résultat</div>'; box.classList.remove('hidden'); return; }
    box.innerHTML = filtered.map(c=>`
        <div class="char-mp-search-item" onclick="startNewCharMpConvoFromModal('${c._id}','${(c.name||'').replace(/'/g,"\\'")}','${c.avatar||''}','${c.color||''}','${c.role||''}','${c.ownerId||''}','${c.ownerUsername||''}')">
            <img src="${c.avatar||''}" class="char-mp-search-avatar" onerror="this.style.opacity=0">
            <div>
                <div style="font-weight:700;font-size:0.85rem;color:${c.color||'white'};">${c.name}</div>
                <div style="font-size:0.7rem;color:var(--text-muted);">${c.role||''} · ${c.ownerUsername||''}</div>
            </div>
        </div>`).join('');
    box.classList.remove('hidden');
});

function startNewCharMpConvoFromModal(othId, othName, othAvatar, othColor, othRole, othOwnerId, othOwnerUsername) {
    const sel = document.getElementById('newConvMySender');
    const myCharId = sel ? sel.value : (myCharacters[0]?myCharacters[0]._id:null);
    if(!myCharId) return alert('Sélectionne d\'abord ton personnage.');
    closeNewConvModal();
    const myChar = myCharacters.find(c=>c._id===myCharId);
    if(!myChar) return;
    const otherChar = { _id:othId, name:othName, avatar:othAvatar, color:othColor, role:othRole, ownerId:othOwnerId, ownerUsername:othOwnerUsername };
    const key = mpKey(myCharId, othId);
    if(!charMpConversations[key]) charMpConversations[key] = { myChar, otherChar, msgs:[], unread:false, lastContent:'' };
    switchView('char-mp');
    openCharMpConvo(key);
}

// ── openCharDmModal depuis le profil ──
function openCharDmModal(targetChar) {
    charDmTarget = targetChar;
    const sel = document.getElementById('charDmSenderSelect');
    if(sel) sel.innerHTML = myCharacters.map(c=>`<option value="${c._id}">${c.name}</option>`).join('');
    document.getElementById('charDmTargetAvatar').src = targetChar.avatar||'';
    document.getElementById('charDmTargetName').textContent = targetChar.name;
    loadCharDmHistory();
    document.getElementById('char-dm-modal').classList.remove('hidden');
    if(sel) sel.onchange = loadCharDmHistory;
}
function closeCharDmModal() { document.getElementById('char-dm-modal').classList.add('hidden'); charDmTarget=null; }

function loadCharDmHistory() {
    if(!charDmTarget) return;
    const sel = document.getElementById('charDmSenderSelect');
    const myCharId = sel ? sel.value : (myCharacters[0]?myCharacters[0]._id:null);
    if(!myCharId) return;
    const key = mpKey(myCharId, charDmTarget._id);
    if(!charMpConversations[key]) {
        const myChar = myCharacters.find(c=>c._id===myCharId);
        if(myChar) charMpConversations[key]={ myChar, otherChar:charDmTarget, msgs:[], unread:false };
    }
    socket.emit('request_char_dm_history', { senderCharId:myCharId, targetCharId:charDmTarget._id });
}

function sendCharDm() {
    if(!charDmTarget || !PLAYER_ID) return;
    const content = document.getElementById('charDmInput').value.trim(); if(!content) return;
    const sel = document.getElementById('charDmSenderSelect');
    const senderChar = sel ? myCharacters.find(c=>c._id===sel.value) : null; if(!senderChar) return;
    socket.emit('send_char_dm', {
        senderCharId:senderChar._id, senderCharName:senderChar.name, senderAvatar:senderChar.avatar, senderColor:senderChar.color, senderRole:senderChar.role, senderOwnerUsername:USERNAME,
        targetCharId:charDmTarget._id, targetCharName:charDmTarget.name, targetOwnerId:charDmTarget.ownerId, targetOwnerUsername:charDmTarget.ownerUsername||'',
        ownerId:PLAYER_ID, content, date:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})
    });
    document.getElementById('charDmInput').value='';
}

function appendCharDmMsg(msg) {
    const c = document.getElementById('char-dm-messages'); if(!c) return;
    const sel = document.getElementById('charDmSenderSelect');
    const myCharId = sel ? sel.value : null;
    const isSelf = String(msg.senderCharId)===String(myCharId);
    const div = document.createElement('div');
    div.className = `cmp-msg ${isSelf?'cmp-msg-self':'cmp-msg-other'}`;
    div.innerHTML = `
        <img src="${msg.senderAvatar||''}" class="cmp-msg-avatar" title="${escapeHtml(msg.senderName||'')}">
        <div class="cmp-msg-bubble" style="--sender-color:${msg.senderColor||'var(--accent)'};">
            <span class="cmp-msg-name">${escapeHtml(msg.senderName||'')}</span>
            <span class="cmp-msg-text">${formatText(msg.content)}</span>
            <span class="cmp-msg-time">${msg.date||''}</span>
        </div>`;
    c.appendChild(div);
}

function initCharMpView() { loadMyCharConvos(); renderCharMpSidebar(); }


socket.on('followers_list_data', (followers) => {
    const listDiv = document.getElementById('followers-list-container'); listDiv.innerHTML = "";
    if(followers.length === 0) listDiv.innerHTML = "<div style='padding:10px; color:#aaa;'>Aucun abonné.</div>";
    followers.forEach(f => {
        listDiv.innerHTML += `<div style="display:flex; align-items:center; padding:8px; border-bottom:1px solid #333;"><img src="${f.avatar}" style="width:30px; height:30px; border-radius:50%; margin-right:10px;"><div><div style="font-weight:bold;">${f.name}</div><div style="font-size:0.8em; color:#aaa;">${f.role}</div></div></div>`;
    });
    document.getElementById('followers-modal').classList.remove('hidden');
});

// --- ACTIONS MSG ---
function setContext(type, data) {
    currentContext = { type, data }; const bar = document.getElementById('context-bar');
    bar.className = 'visible';
    if(type === 'dm') bar.classList.add('dm-context'); else bar.classList.remove('dm-context');
    document.getElementById('txtInput').focus();
    if (type === 'reply') { document.getElementById('context-icon').innerHTML = '<i class="fa-solid fa-reply"></i>'; document.getElementById('context-text').innerHTML = `Répondre à <strong>${data.author}</strong>`; }
    else if (type === 'edit') { document.getElementById('context-icon').innerHTML = '<i class="fa-solid fa-pen"></i>'; document.getElementById('context-text').innerHTML = `Modifier message`; document.getElementById('txtInput').value = data.content; }
}
function cancelContext() { currentContext = null; document.getElementById('context-bar').className = 'hidden'; document.getElementById('txtInput').value = ""; }
function triggerReply(id, author, content) { setContext('reply', { id, author, content }); }
function triggerEdit(id, content) { setContext('edit', { id, content }); }
function triggerDelete(id) { if(confirm("Supprimer ?")) socket.emit('delete_message', id); }

async function sendMessage() {
    const txt = document.getElementById('txtInput'); const content = txt.value.trim();
    let finalMediaUrl = null, finalMediaType = null;
    if (pendingAttachment) {
        document.getElementById('chat-staging').innerHTML = 'Envoi...';
        let rType = undefined; if(pendingAttachment.type === 'audio') rType = 'video';
        finalMediaUrl = await uploadToCloudinary(pendingAttachment.file, rType); finalMediaType = pendingAttachment.type;
        clearStaging(); if (!finalMediaUrl) return alert("Echec envoi média.");
    }
    if (!content && !finalMediaUrl) return;
    if (currentDmTarget) {
        socket.emit('send_dm', { sender: USERNAME, target: currentDmTarget, content: content || finalMediaUrl, type: finalMediaType || "text", date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) });
        txt.value = ''; cancelContext(); return;
    }
    if (content === "/clear" && !finalMediaUrl) { if(IS_ADMIN) socket.emit('admin_clear_room', currentRoomId); txt.value = ''; return; }
    if (currentContext && currentContext.type === 'edit') { socket.emit('edit_message', { id: currentContext.data.id, newContent: content }); txt.value = ''; cancelContext(); return; }
    if(!currentSelectedChar) return alert("Perso requis !");
    
    const baseMsg = { senderName: currentSelectedChar.name, senderColor: currentSelectedChar.color || "#fff", senderAvatar: currentSelectedChar.avatar, senderRole: currentSelectedChar.role, partyName: currentSelectedChar.partyName || null, partyLogo: currentSelectedChar.partyLogo || null, ownerId: PLAYER_ID, targetName: "", roomId: currentRoomId, date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), replyTo: (currentContext && currentContext.type === 'reply') ? { id: currentContext.data.id, author: currentContext.data.author, content: currentContext.data.content } : null };
    if (finalMediaUrl) socket.emit('message_rp', { ...baseMsg, content: finalMediaUrl, type: finalMediaType });
    if (content) socket.emit('message_rp', { ...baseMsg, content: content, type: "text" });
    txt.value = ''; cancelContext();
}

socket.on('history_data', (msgs) => { 
    if(currentDmTarget) return; 
    const container = document.getElementById('messages'); container.innerHTML = ""; lastMessageData = { author: null, time: 0 };
    const splitId = firstUnreadMap[currentRoomId];
    msgs.forEach(msg => { if(splitId && msg._id === splitId) container.innerHTML += `<div class="new-msg-separator">-- Nouveaux --</div>`; displayMessage(msg); });
    if(firstUnreadMap[currentRoomId]) delete firstUnreadMap[currentRoomId];
    scrollToBottom(); 
});
socket.on('message_rp', (msg) => { 
    if (msg.ownerId !== PLAYER_ID && notificationsEnabled) notifSound.play().catch(e => {});
    if(String(msg.roomId) === String(currentRoomId) && !currentDmTarget) { displayMessage(msg); scrollToBottom(); } 
    else { unreadRooms.add(String(msg.roomId)); if (!firstUnreadMap[msg.roomId]) firstUnreadMap[msg.roomId] = msg._id; updateRoomListUI(); }
});
socket.on('message_deleted', (msgId) => { const el = document.getElementById(`msg-${msgId}`); if(el) el.remove(); });
socket.on('message_updated', (data) => { const el = document.getElementById(`content-${data.id}`); if(el) { el.innerHTML = formatText(data.newContent); const meta = el.closest('.msg-col-content').querySelector('.timestamp'); if(meta && !meta.textContent.includes('(modifié)')) meta.textContent += ' (modifié)'; } });

function formatText(text) { 
    if(!text) return ""; 
    // [NOUVEAU] Détecter les messages cryptés AVANT tout autre traitement
    if(text.includes('[CRYPTO]')) {
        return text.replace(/\[CRYPTO\](.*?)\|(.*?)\[\/CRYPTO\]/g, (match, enc, glitch) => {
            const safeEnc = enc.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            return `<div class="crypto-message"><span class="crypto-icon"><i class="fa-solid fa-lock"></i></span><span class="crypto-glitch">${glitch}…</span><button class="crypto-unlock-btn" onclick="openDecryptModal(null,'${safeEnc}')"><i class="fa-solid fa-key"></i> Déchiffrer</button></div>`;
        });
    }
    return text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\*(.*?)\*/g, '<i>$1</i>').replace(/\|\|(.*?)\|\|/g, '<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>'); 
}
function getYoutubeId(url) { const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/); return (match && match[2].length === 11) ? match[2] : null; }

function createCustomAudioPlayer(src) {
    const wrapper = document.createElement('div'); wrapper.className = 'custom-audio-player';
    wrapper.innerHTML = `<button class="audio-btn play-btn"><i class="fa-solid fa-play"></i></button><div class="audio-progress"><div class="audio-progress-fill"></div></div><span class="audio-time">00:00</span>`;
    const audio = new Audio(src); const btn = wrapper.querySelector('.play-btn'); const fill = wrapper.querySelector('.audio-progress-fill'); const time = wrapper.querySelector('.audio-time');
    audio.addEventListener('loadedmetadata', () => { time.textContent = `${Math.floor(audio.duration/60)}:${Math.floor(audio.duration%60).toString().padStart(2,'0')}`; });
    audio.addEventListener('timeupdate', () => { fill.style.width = (audio.currentTime/audio.duration)*100 + '%'; time.textContent = `${Math.floor(audio.currentTime/60)}:${Math.floor(audio.currentTime%60).toString().padStart(2,'0')}`; });
    audio.addEventListener('ended', () => { btn.innerHTML = '<i class="fa-solid fa-play"></i>'; fill.style.width = '0%'; });
    btn.addEventListener('click', () => { if(audio.paused) { audio.play(); btn.innerHTML = '<i class="fa-solid fa-pause"></i>'; } else { audio.pause(); btn.innerHTML = '<i class="fa-solid fa-play"></i>'; } });
    return wrapper;
}

function displayMessage(msg, isDm = false) {
    const div = document.createElement('div'); div.className = 'message-container'; if(isDm) div.classList.add('dm-message'); div.id = `msg-${msg._id}`;
    let senderName, senderAvatar, senderColor, senderRole, canEdit = false, canDelete = false;
    if (isDm) { senderName = msg.sender || msg.senderName; senderAvatar = `https://ui-avatars.com/api/?name=${senderName}&background=random&color=fff&size=64`; senderColor = "#dbdee1"; senderRole = "Utilisateur"; } 
    else { senderName = msg.senderName; senderAvatar = msg.senderAvatar; senderColor = msg.senderColor; senderRole = msg.senderRole; canEdit = (msg.ownerId === PLAYER_ID); canDelete = (msg.ownerId === PLAYER_ID) || IS_ADMIN; }
    if (!isDm && USERNAME && msg.content && typeof msg.content === 'string' && msg.content.includes(`@${USERNAME}`)) { div.classList.add('mentioned'); }
    const msgTime = new Date(msg.timestamp || Date.now()).getTime(); const timeDiff = msgTime - lastMessageData.time;
    const isGroup = (!isDm && !msg.replyTo && senderName === lastMessageData.author && timeDiff < 120000 && msg.type !== 'image' && msg.type !== 'video'); 
    if (isGroup) { div.classList.add('msg-group-followup'); const stamp = document.createElement('span'); stamp.className = 'group-timestamp'; stamp.innerText = msg.date.substring(0, 5); div.appendChild(stamp); } 
    else { lastMessageData = { author: senderName, time: msgTime }; }
    let actionsHTML = "";
    if (!isDm) {
         actionsHTML += `<div class="msg-actions"><button class="action-btn" onclick="triggerReply('${msg._id}', '${senderName.replace(/'/g, "\\'")}', '${(msg.type==='text'?msg.content:'Média').replace(/'/g, "\\'")}')" title="Répondre"><i class="fa-solid fa-reply"></i></button>`;
         if (msg.type === 'text' && canEdit) actionsHTML += `<button class="action-btn" onclick="triggerEdit('${msg._id}', '${msg.content.replace(/'/g, "\\'")}')" title="Modifier"><i class="fa-solid fa-pen"></i></button>`;
         if (canDelete) actionsHTML += `<button class="action-btn" onclick="triggerDelete('${msg._id}')"><i class="fa-solid fa-trash"></i></button>`;
         actionsHTML += `</div>`;
    }
    let contentHTML = "";
    if (msg.type === "image") contentHTML = `<img src="${msg.content}" class="chat-image" onclick="window.open(this.src)">`;
    else if (msg.type === "video") { const ytId = getYoutubeId(msg.content); if (ytId) contentHTML = `<iframe class="video-frame" src="https://www.youtube.com/embed/${ytId}" allowfullscreen></iframe>`; else contentHTML = `<video class="video-direct" controls><source src="${msg.content}"></video>`; } 
    else if (msg.type === "audio") { contentHTML = `<div id="audio-placeholder-${msg._id}"></div>`; }
    else contentHTML = `<div class="text-body" id="content-${msg._id}">${formatText(msg.content)}</div>`;
    const editedTag = (msg.edited && msg.type === 'text') ? '<span class="timestamp" style="font-size:0.65rem">(modifié)</span>' : '';
    const avatarClick = isDm ? "" : `onclick="openProfile('${senderName.replace(/'/g, "\\'")}')"`;
    let replyHTML = "";
    if (msg.replyTo && msg.replyTo.author) { replyHTML = `<div class="reply-context-line"><div class="reply-spine"></div><span style="font-weight:600; cursor:pointer;">@${msg.replyTo.author}</span> <span style="font-style:italic; opacity:0.8;">${msg.replyTo.content}</span></div>`; }
    let innerHTML = ""; if(replyHTML) innerHTML += replyHTML; innerHTML += `<div style="display:flex; width:100%;"><div class="msg-col-avatar">`;
    if(!isGroup) { innerHTML += `<img src="${senderAvatar}" class="avatar-img" ${avatarClick}>`; }
    innerHTML += `</div><div class="msg-col-content">`;
    if(!isGroup) { 
        const partyBadgeHTML = (!isDm && msg.partyName && msg.partyLogo) ? `<span class="party-badge"><img src="${msg.partyLogo}" class="party-logo"> ${msg.partyName}</span>` : '';
        innerHTML += `<div class="msg-header"><span class="char-name" style="color:${senderColor}" ${avatarClick}>${senderName}</span>${partyBadgeHTML}${senderRole ? `<span class="char-role">${senderRole}</span>` : ''}<span class="timestamp">${msg.date}</span></div>`; 
    }
    innerHTML += contentHTML + editedTag + `</div>${actionsHTML}</div>`; div.innerHTML = innerHTML;
    document.getElementById('messages').appendChild(div);
    if (msg.type === 'audio') { const placeholder = document.getElementById(`audio-placeholder-${msg._id}`); if(placeholder) placeholder.replaceWith(createCustomAudioPlayer(msg.content)); }
}

function scrollToBottom() { const d = document.getElementById('messages'); d.scrollTop = d.scrollHeight; }
document.getElementById('txtInput').addEventListener('keyup', (e) => { if(e.key === 'Enter') sendMessage(); });

// --- FEED LOGIC & TYPING ---
function loadFeed() { socket.emit('request_feed'); }

document.getElementById('postContent').addEventListener('input', (e) => { 
    document.getElementById('char-count').textContent = `${e.target.value.length}/1000`; 
    if(!currentFeedCharId) return;
    const char = myCharacters.find(c => c._id === currentFeedCharId);
    const typingName = char ? char.name : USERNAME;
    socket.emit('typing_feed_start', { charName: typingName });
    clearTimeout(feedTypingTimeout);
    feedTypingTimeout = setTimeout(() => { socket.emit('typing_feed_stop', { charName: typingName }); }, 2000);
});

socket.on('display_feed_typing', (data) => { feedTypers.add(data.charName); updateFeedTypingUI(); });
socket.on('hide_feed_typing', (data) => { feedTypers.delete(data.charName); updateFeedTypingUI(); });
function updateFeedTypingUI() {
    const ind = document.getElementById('feed-typing-indicator');
    if(feedTypers.size > 0) { const names = Array.from(feedTypers).join(', '); ind.textContent = `${names} rédige un post...`; ind.classList.remove('hidden'); } 
    else { ind.classList.add('hidden'); }
}

function togglePollUI() {
    const ui = document.getElementById('poll-creation-ui'); pollUIOpen = !pollUIOpen;
    if(pollUIOpen) { ui.classList.remove('hidden'); pollOptions = []; addPollOption(); addPollOption(); } 
    else { ui.classList.add('hidden'); }
}
function addPollOption() { pollOptions.push(''); renderPollUI(); }
function renderPollUI() {
    const container = document.getElementById('pollOptions'); container.innerHTML = '';
    pollOptions.forEach((opt, idx) => {
        const div = document.createElement('div'); div.style.marginBottom = '8px';
        div.innerHTML = `<input type="text" placeholder="Option ${idx + 1}..." value="${opt}" onchange="pollOptions[${idx}] = this.value;" style="width:100%; background:#383a40; border:none; color:white; padding:8px; border-radius:4px; font-family:inherit;">`;
        container.appendChild(div);
    });
}
function closePollUI() { document.getElementById('poll-creation-ui').classList.add('hidden'); pollUIOpen = false; pollOptions = []; }

async function previewPostFile() {
    const file = document.getElementById('postMediaFile').files[0];
    if(file) {
        document.getElementById('postFileStatus').style.display = 'block'; document.getElementById('postFileStatus').textContent = "Upload...";
        const url = await uploadToCloudinary(file);
        if(url) { document.getElementById('postMediaUrl').value = url; document.getElementById('postFileStatus').textContent = "Prêt !"; }
    }
}

function submitPost() {
    const content = document.getElementById('postContent').value.trim();
    const mediaUrl = document.getElementById('postMediaUrl').value.trim();
    const isAnonymous = document.getElementById('postAnonymous').checked;
    const isBreakingNews = document.getElementById('postBreakingNews').checked;
    
    if(!content && !mediaUrl) return alert("Contenu vide.");
    if(!currentFeedCharId) return alert("Aucun perso sélectionné pour le Feed.");
    const char = myCharacters.find(c => c._id === currentFeedCharId);
    if(!char) return alert("Perso invalide.");

    let mediaType = null;
    if(mediaUrl) {
        if(getYoutubeId(mediaUrl) || mediaUrl.match(/\.(mp4|webm|ogg)$/i) || mediaUrl.includes('/video/upload')) mediaType = 'video';
        else if (mediaUrl.includes('.webm') || mediaUrl.includes('/raw/upload') && !mediaUrl.includes('image')) mediaType = 'audio';
        else mediaType = 'image';
        if(mediaUrl.endsWith('.webm') && !mediaType) mediaType = 'video'; 
    }
    
    let poll = null;
    if(pollOptions.length > 0) {
        const question = document.getElementById('pollQuestion').value.trim();
        if(question) { poll = { question, options: pollOptions.map(text => ({ text: text.trim(), voters: [] })) }; }
    }
    
    const postData = { 
        authorCharId: char._id, authorName: char.name, authorAvatar: char.avatar, authorRole: char.role, authorColor: char.color,
        partyName: char.partyName, partyLogo: char.partyLogo, content, mediaUrl, mediaType, 
        date: new Date().toLocaleDateString(), ownerId: PLAYER_ID, isAnonymous, isBreakingNews, poll
    };
    
    socket.emit('create_post', postData);
    socket.emit('typing_feed_stop', { charName: char.name });
    
    // Pub boost bourse
    const isPub = document.getElementById('postIsPub')?.checked;
    const pubStockId = isPub ? document.getElementById('postPubStockId')?.value : null;
    if(isPub && pubStockId) socket.emit('pub_boost_stock', { stockId: pubStockId });
    
    document.getElementById('postContent').value = ""; document.getElementById('postMediaUrl').value = ""; document.getElementById('postMediaFile').value = ""; 
    document.getElementById('postFileStatus').style.display = 'none'; document.getElementById('postAnonymous').checked = false; document.getElementById('postBreakingNews').checked = false;
    document.getElementById('char-count').textContent = `0/1000`; pollOptions = []; document.getElementById('poll-creation-ui').classList.add('hidden'); pollUIOpen = false;
    const pubCb = document.getElementById('postIsPub'); if(pubCb) { pubCb.checked = false; toggleFeedPubSelect(); }
}

function votePoll(postId, optionIndex) {
    if(!currentFeedCharId) return alert("Sélectionnez un personnage dans le Feed !");
    socket.emit('vote_poll', { postId, optionIndex, charId: currentFeedCharId });
}

function adminInjectVote(postId, optionIndex, count) {
    if(!IS_ADMIN) return; socket.emit('admin_inject_vote', { postId, optionIndex, count });
}

function toggleLike(id) { 
    if(!PLAYER_ID) return; if(!currentFeedCharId) return alert("Sélectionnez un perso (Feed).");
    socket.emit('like_post', { postId: id, charId: currentFeedCharId }); 
}
function openArticleEditModal(postId) {
    const post = presseArticlesCache.find(a => String(a._id) === postId);
    if(!post) return;
    let titleText = '', bodyText = post.content || '';
    const titleMatch = post.content && post.content.match(/^\[TITRE\](.*?)\[\/TITRE\]\n?([\s\S]*)/);
    if(titleMatch) { titleText = titleMatch[1]; bodyText = titleMatch[2]; }
    document.getElementById('editArticleId').value = postId;
    document.getElementById('editArticleTitle').value = titleText;
    document.getElementById('editArticleContent').value = bodyText;
    document.getElementById('article-edit-modal').classList.remove('hidden');
}

function closeArticleEditModal() {
    document.getElementById('article-edit-modal').classList.add('hidden');
}

function submitArticleEdit() {
    const postId = document.getElementById('editArticleId').value;
    const title = document.getElementById('editArticleTitle').value.trim();
    const body = document.getElementById('editArticleContent').value.trim();
    if(!postId) return;
    const newContent = title ? `[TITRE]${title}[/TITRE]\n${body}` : body;
    socket.emit('edit_post', { postId, content: newContent, ownerId: PLAYER_ID });
    closeArticleEditModal();
}

function deletePost(id) { if(confirm("Supprimer ?")) socket.emit('delete_post', id); }

let currentDetailPostId = null;
function openPostDetail(id) {
    const postEl = document.getElementById(`post-${id}`); if(!postEl) return;
    currentDetailPostId = id;
    const clone = postEl.cloneNode(true); clone.onclick = null; clone.style.border="none"; clone.classList.remove('highlight-new');
    const old = clone.querySelector('.comments-section'); if(old) old.remove();
    document.getElementById('post-detail-content').innerHTML = ""; document.getElementById('post-detail-content').appendChild(clone);
    document.getElementById('post-detail-comments-list').innerHTML = postEl.querySelector('.comments-list')?.innerHTML || "";
    document.getElementById('post-detail-modal').classList.remove('hidden'); clearCommentStaging();
    
    document.getElementById('btn-detail-comment').onclick = async () => {
        const txt = document.getElementById('post-detail-comment-input').value.trim();
        let mediaUrl = null, mediaType = null;
        if(pendingCommentAttachment && pendingCommentAttachment.files[0]) {
             let rType = (pendingCommentAttachment.type === 'audio') ? 'video' : undefined;
             mediaUrl = await uploadToCloudinary(pendingCommentAttachment.files[0], rType); mediaType = pendingCommentAttachment.type;
        }
        if(!txt && !mediaUrl) return;
        if(!currentFeedCharId) return alert("Sélectionnez un perso (Feed).");
        const char = myCharacters.find(c => c._id === currentFeedCharId);
        
        socket.emit('post_comment', { 
            postId: id, 
            comment: { authorCharId: char._id, authorName: char.name, authorAvatar: char.avatar, content: txt, mediaUrl, mediaType, date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), ownerId: PLAYER_ID } 
        });
        document.getElementById('post-detail-comment-input').value = ""; clearCommentStaging();
    };
}
function closePostDetail() { document.getElementById('post-detail-modal').classList.add('hidden'); currentDetailPostId = null; }
function stageCommentMedia(input, forcedType) {
    const file = input.files[0]; if(!file) return;
    let type = forcedType || (file.type.startsWith('image') ? 'image' : 'video');
    pendingCommentAttachment = { files: input.files, type };
    document.getElementById('comment-staging').classList.remove('hidden');
    document.getElementById('comment-staging').innerHTML = `<span class="staging-info">${type} prêt</span> <button class="btn-clear-stage" onclick="clearCommentStaging()">X</button>`;
}
function clearCommentStaging() { pendingCommentAttachment = null; document.getElementById('comment-staging').classList.add('hidden'); document.getElementById('comment-file-input').value = ""; }
function deleteComment(postId, commentId) { if(confirm("Supprimer ?")) socket.emit('delete_comment', { postId, commentId }); }

socket.on('feed_data', (posts) => {
    feedPostsCache = posts;
    const c = document.getElementById('feed-stream'); c.innerHTML = ""; posts.forEach(p => c.appendChild(createPostElement(p)));
    if(currentView === 'accueil') renderAccueil();
});
socket.on('new_post', (post) => { 
    if(currentView !== 'feed') document.getElementById('btn-view-feed').classList.add('nav-notify'); 
    document.getElementById('feed-stream').prepend(createPostElement(post)); 
});
socket.on('post_updated', (post) => {
    const el = document.getElementById(`post-${post._id}`); if(el) el.replaceWith(createPostElement(post));
    if(currentDetailPostId === post._id) {
        document.getElementById('post-detail-comments-list').innerHTML = generateCommentsHTML(post.comments, post._id);
        const likeBtn = document.querySelector('#post-detail-content .action-item'); if(likeBtn) likeBtn.innerHTML = `<i class="fa-solid fa-heart"></i> ${post.likes.length}`;
    }
});
socket.on('post_deleted', (id) => { const el = document.getElementById(`post-${id}`); if(el) el.remove(); if(currentDetailPostId === id) closePostDetail(); });
socket.on('reload_posts', () => loadFeed());

function generateCommentsHTML(comments, postId) {
    if(!comments || comments.length === 0) return '<div class="comment-empty"><i class="fa-regular fa-comment"></i><p>Aucun commentaire pour l\'instant…</p></div>';
    let html = "";
    comments.forEach(c => {
        const delBtn = IS_ADMIN ? `<button class="comment-del-btn" onclick="deleteComment('${postId}', '${c.id}')"><i class="fa-solid fa-trash"></i></button>` : "";
        let mediaHtml = "";
        if(c.mediaUrl) {
            if(c.mediaType === 'image') mediaHtml = `<img src="${c.mediaUrl}" class="comment-media">`;
            if(c.mediaType === 'video') mediaHtml = `<video src="${c.mediaUrl}" controls class="comment-media"></video>`;
            if(c.mediaType === 'audio') mediaHtml = `<audio src="${c.mediaUrl}" controls style="width:100%; margin-top:5px;"></audio>`;
        }
        html += `<div class="comment-item"><img src="${c.authorAvatar}" class="comment-avatar" onclick="openProfile('${c.authorName.replace(/'/g, "\\'")}')"><div class="comment-bubble"><div class="comment-meta"><span class="comment-author">${c.authorName}</span><span class="comment-time">${c.date}</span>${delBtn}</div><div class="comment-text">${c.content}${mediaHtml}</div></div></div>`;
    });
    return html;
}

function createPostElement(post) {
    const div = document.createElement('div'); div.className = 'post-card'; div.id = `post-${post._id}`;
    
    // NOUVEAU : MODE JOURNALISTE
    const isJournalistMode = post.content && (post.content.length > 300 || post.isBreakingNews);
    
    if(post.isBreakingNews) div.classList.add('post-breaking-news');
    if(post.isAnonymous) div.classList.add('post-anonymous');
    if(isJournalistMode) div.classList.add('post-article');
    
    const lastVisit = parseInt(localStorage.getItem('last_feed_visit') || '0');
    if (new Date(post.timestamp).getTime() > lastVisit && currentView === 'feed') div.classList.add('post-highlight');
    
    const isLiked = post.likes.includes(currentFeedCharId); 
    const delBtn = (IS_ADMIN || post.ownerId === PLAYER_ID) ? `<button class="action-item" style="position:absolute; top:16px; right:16px; color:#da373c;" onclick="event.stopPropagation(); deletePost('${post._id}')"><i class="fa-solid fa-trash"></i></button>` : '';
    
    // GESTION MÉDIAS ET BANNIÈRE JOURNALISTE
    let mediaHTML = "";
    let bannerHTML = "";
    if(post.mediaUrl) {
        if(post.mediaType === 'video' || post.mediaUrl.includes('/video/upload')) {
             const ytId = getYoutubeId(post.mediaUrl);
             if(ytId) mediaHTML = `<iframe class="post-media" src="https://www.youtube.com/embed/${ytId}" frameborder="0" allowfullscreen></iframe>`;
             else mediaHTML = `<video class="post-media" controls src="${post.mediaUrl}"></video>`;
        } else if (post.mediaType === 'audio') { mediaHTML = `<audio controls src="${post.mediaUrl}" style="width:100%; margin-top:10px;"></audio>`; } 
        else { 
             if(isJournalistMode) bannerHTML = `<img src="${post.mediaUrl}" class="post-banner">`;
             else mediaHTML = `<img src="${post.mediaUrl}" class="post-media">`; 
        }
    }
    
    // GESTION TITRE JOURNALISTE
    let articleTitleHTML = "";
    if (isJournalistMode && post.content) {
        const words = post.content.split(/\s+/);
        const titleText = words.slice(0, 10).join(' ') + (words.length > 10 ? '...' : '');
        articleTitleHTML = `<div class="post-article-title">${titleText}</div>`;
    }
    
    let displayName = post.authorName; let displayAvatar = post.authorAvatar; let displayRole = post.authorRole;
    if(post.isAnonymous) { displayName = "Source Anonyme"; displayAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%23383a40' width='100' height='100'/%3E%3Ctext x='50' y='55' font-size='50' fill='%23666' text-anchor='middle' dominant-baseline='middle'%3E%3F%3C/text%3E%3C/svg%3E"; displayRole = "Leak"; }
    
    let pollHTML = "";
    if(post.poll && post.poll.options && post.poll.options.length > 0) {
        const totalVoters = post.poll.options.reduce((sum, opt) => sum + opt.voters.length, 0);
        const hasVoted = post.poll.options.some(opt => opt.voters.includes(currentFeedCharId));
        pollHTML = `<div class="poll-container"><div class="poll-question"><i class="fa-solid fa-chart-column" style="margin-right:6px; color:var(--accent);"></i>${post.poll.question}</div>`;
        post.poll.options.forEach((opt, idx) => {
            const pct = totalVoters > 0 ? Math.round((opt.voters.length / totalVoters) * 100) : 0;
            const isVoted = opt.voters.includes(currentFeedCharId);
            const adminPopup = IS_ADMIN ? `<div class="poll-admin-popup"><button class="poll-admin-popup-btn" onclick="event.stopPropagation(); adminInjectVote('${post._id}', ${idx}, 1)">+1 Vote</button><button class="poll-admin-popup-btn" onclick="event.stopPropagation(); adminInjectVote('${post._id}', ${idx}, 10)">+10 Votes</button><button class="poll-admin-popup-btn" onclick="event.stopPropagation(); adminInjectVote('${post._id}', ${idx}, 100)">+100 Votes</button></div>` : '';
            if(hasVoted) {
                pollHTML += `<div class="poll-option poll-option-wrap"><div class="poll-results-bar ${isVoted ? 'poll-voted-bar' : ''}"><div class="poll-bar-fill" style="width:${pct}%"></div><div class="poll-result-text"><span>${isVoted ? '✓ ' : ''}${opt.text}</span><span><strong>${pct}%</strong> <span style="opacity:0.6">(${opt.voters.length})</span></span></div></div>${adminPopup}</div>`;
            } else {
                pollHTML += `<div class="poll-option poll-option-wrap"><button class="poll-option-btn" onclick="event.stopPropagation(); votePoll('${post._id}', ${idx})">${opt.text}</button>${adminPopup}</div>`;
            }
        });
        pollHTML += `<div class="poll-total">${totalVoters} vote${totalVoters !== 1 ? 's' : ''}</div></div>`;
    }
    
    const bodyWrapperStart = isJournalistMode ? `<div class="post-article-body">` : ``;
    const bodyWrapperEnd = isJournalistMode ? `</div>` : ``;

    div.innerHTML = `
        ${bannerHTML}
        ${bodyWrapperStart}
            ${delBtn}
            <div class="post-header" onclick="event.stopPropagation(); openProfile('${displayName.replace(/'/g, "\\'")}')">
                <img src="${displayAvatar}" class="post-avatar">
                <div class="post-meta">
                    <div class="post-author">${displayName}${post.partyName && post.partyLogo && !post.isAnonymous ? `<span class="party-badge"><img src="${post.partyLogo}" class="party-logo"> ${post.partyName}</span>` : ''}</div>
                    <div class="post-role">${displayRole}</div>
                </div>
                <span class="post-date">${post.date}</span>
            </div>
            ${articleTitleHTML}
            <div class="post-content" onclick="openPostDetail('${post._id}')">${formatText(post.content)}</div>
            ${mediaHTML}
            ${pollHTML}
            <div class="post-actions">
                <button class="action-item ${isLiked?'liked':''}" onclick="event.stopPropagation(); toggleLike('${post._id}')"><i class="fa-solid fa-heart"></i> ${post.likes.length}</button>
                <button class="action-item" onclick="event.stopPropagation(); openPostDetail('${post._id}')"><i class="fa-solid fa-comment"></i> ${post.comments.length}</button>
                ${IS_ADMIN ? `<button class="action-item" onclick="event.stopPropagation(); openAdminStatsModal('${post._id}', ${post.likes.length})" title="Admin: modifier likes" style="color:var(--warning);"><i class="fa-solid fa-pen"></i></button>` : ''}
            </div>
        ${bodyWrapperEnd}
        <div class="comments-list hidden">${generateCommentsHTML(post.comments, post._id)}</div>`;
    return div;
}

let notifications = [];
socket.on('notifications_data', (d) => { notifications = d; updateNotificationBadge(); });
socket.on('notification_dispatch', (n) => { if(n.targetOwnerId === PLAYER_ID) { notifications.unshift(n); updateNotificationBadge(); if(notificationsEnabled) notifSound.play().catch(e=>{}); } });
function updateNotificationBadge() {
    const c = notifications.filter(n => !n.isRead).length; const b = document.getElementById('notif-badge');
    if(c > 0) { b.textContent = c; b.classList.remove('hidden'); } else b.classList.add('hidden');
}
function openNotifications() {
    document.getElementById('notifications-modal').classList.remove('hidden');
    const list = document.getElementById('notif-list'); list.innerHTML = "";
    if(notifications.length === 0) list.innerHTML = "<div style='text-align:center; padding:20px; color:#777'>Rien.</div>";
    notifications.forEach(n => {
        list.innerHTML += `<div class="notif-item ${!n.isRead?'unread':''}"><div class="notif-icon"><i class="fa-solid fa-bell"></i></div><div class="notif-content"><strong>${n.fromName}</strong> ${n.content}</div></div>`;
    });
    socket.emit('mark_notifications_read', PLAYER_ID); notifications.forEach(n=>n.isRead=true); updateNotificationBadge();
}
function closeNotifications() { document.getElementById('notifications-modal').classList.add('hidden'); }

document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('feed-char-avatar-wrapper');
    if(wrapper && !wrapper.contains(e.target)) {
        const dd = document.getElementById('feed-char-dropdown');
        if(dd) dd.classList.add('hidden');
    }
    const pwrapper = document.getElementById('presse-char-avatar-wrapper');
    if(pwrapper && !pwrapper.contains(e.target)) {
        const pdd = document.getElementById('presse-char-dropdown');
        if(pdd) pdd.classList.add('hidden');
    }
});

// ==================== PRESSE ====================
const URGENCY_CONFIG = {
    urgent:   { label: '🚨 URGENT',               cls: 'urgency-urgent'   },
    enquete:  { label: '🔍 ENQUÊTE',              cls: 'urgency-enquete'  },
    officiel: { label: '📢 COMMUNIQUÉ OFFICIEL',  cls: 'urgency-officiel' },
    economie: { label: '📉 ÉCONOMIE',             cls: 'urgency-economie' }
};

async function previewPresseFile() {
    const file = document.getElementById('presseMediaFile').files[0];
    if(file) {
        const url = await uploadToCloudinary(file);
        if(url) document.getElementById('presseMediaUrl').value = url;
    }
}

function submitArticle() {
    const title = document.getElementById('presseTitle').value.trim();
    const content = document.getElementById('presseContent').value.trim();
    const mediaUrl = document.getElementById('presseMediaUrl').value.trim();
    const urgencyLevel = document.getElementById('presseUrgency').value || null;
    if(!title && !content) return alert("Article vide.");
    if(!currentPresseCharId) return alert("Aucun journaliste sélectionné.");
    const char = myCharacters.find(c => c._id === currentPresseCharId);
    if(!char) return alert("Personnage introuvable.");

    let mediaType = null;
    if(mediaUrl) {
        if(getYoutubeId(mediaUrl) || mediaUrl.match(/\.(mp4|webm|ogg)$/i) || mediaUrl.includes('/video/upload')) mediaType = 'video';
        else if(mediaUrl.includes('.webm') || mediaUrl.includes('/raw/upload')) mediaType = 'audio';
        else mediaType = 'image';
    }

    const articleData = {
        authorCharId: char._id, authorName: char.name, authorAvatar: char.avatar, authorRole: char.role, authorColor: char.color,
        partyName: char.partyName, partyLogo: char.partyLogo,
        content: `[TITRE]${title}[/TITRE]\n${content}`,
        mediaUrl, mediaType,
        date: new Date().toLocaleDateString(), ownerId: PLAYER_ID,
        isAnonymous: false, isBreakingNews: urgencyLevel === 'urgent',
        urgencyLevel,
        isArticle: true, poll: null
    };

    socket.emit('create_post', articleData);
    
    // Pub boost bourse
    const isPresseP = document.getElementById('presseIsPub')?.checked;
    const pressePubId = isPresseP ? document.getElementById('pressePubStockId')?.value : null;
    if(isPresseP && pressePubId) socket.emit('pub_boost_stock', { stockId: pressePubId });

    document.getElementById('presseTitle').value = '';
    document.getElementById('presseContent').value = '';
    document.getElementById('presseMediaUrl').value = '';
    document.getElementById('presseMediaFile').value = '';
    document.getElementById('presseUrgency').value = '';
    const presseP = document.getElementById('presseIsPub'); if(presseP) { presseP.checked = false; togglePressePubSelect(); }
}

function createArticleElement(post) {
    const div = document.createElement('div');
    div.className = 'article-card';
    if(post.isHeadline) div.classList.add('article-headline');
    if(post.urgencyLevel === 'urgent') div.classList.add('article-breaking');
    div.id = `article-${post._id}`;

    const delBtn = (IS_ADMIN || post.ownerId === PLAYER_ID) ? `<button class="article-del-btn" onclick="event.stopPropagation(); deletePost('${post._id}')"><i class="fa-solid fa-trash"></i></button>` : '';
    const editBtn = (post.ownerId === PLAYER_ID || IS_ADMIN) ? `<button class="article-edit-btn" onclick="event.stopPropagation(); openArticleEditModal('${post._id}')"><i class="fa-solid fa-pen"></i></button>` : '';
    const headlineBtn = IS_ADMIN ? `<button class="article-headline-btn" onclick="event.stopPropagation(); toggleHeadline('${post._id}', ${!post.isHeadline})" title="${post.isHeadline ? 'Retirer de la Une' : 'Mettre à la Une'}"><i class="fa-solid fa-star"></i> ${post.isHeadline ? 'Retirer la Une' : 'La Une'}</button>` : '';

    let titleText = '', bodyText = post.content || '';
    const titleMatch = post.content && post.content.match(/^\[TITRE\](.*?)\[\/TITRE\]\n?([\s\S]*)/);
    if(titleMatch) { titleText = titleMatch[1]; bodyText = titleMatch[2]; }
    else {
        const words = (post.content || '').split(/\s+/);
        titleText = words.slice(0, 8).join(' ') + (words.length > 8 ? '...' : '');
    }

    let bannerHTML = '';
    if(post.mediaUrl && post.mediaType === 'image') bannerHTML = `<img src="${post.mediaUrl}" class="article-banner">`;

    const partyHTML = post.partyName && post.partyLogo ? `<span class="party-badge"><img src="${post.partyLogo}" class="party-logo"> ${post.partyName}</span>` : '';

    let urgencyHTML = '';
    if(post.urgencyLevel && URGENCY_CONFIG[post.urgencyLevel]) {
        const uc = URGENCY_CONFIG[post.urgencyLevel];
        urgencyHTML = `<span class="article-urgency-tag ${uc.cls}">${uc.label}</span>`;
    }

    // Lettrine : première lettre du corps en grand
    let articleBodyHTML = '';
    if(bodyText && bodyText.trim().length > 0) {
        const firstChar = bodyText.trim().charAt(0);
        const rest = bodyText.trim().slice(1);
        articleBodyHTML = `<div class="article-content"><span class="article-dropcap">${escapeHtml(firstChar)}</span>${formatText(rest)}</div>`;
    } else {
        articleBodyHTML = `<div class="article-content"></div>`;
    }

    div.innerHTML = `
        ${bannerHTML}
        <div class="article-body">
            ${delBtn}
            ${editBtn}
            ${headlineBtn}
            ${urgencyHTML}
            <h2 class="article-title">${escapeHtml(titleText)}</h2>
            <div class="article-separator"></div>
            ${articleBodyHTML}
            <div class="article-footer-signature" onclick="event.stopPropagation(); openProfile('${post.authorName.replace(/'/g, "\\'")}')">
                <img src="${post.authorAvatar}" class="article-sig-avatar">
                <div>
                    <div class="article-sig-name">${post.authorName}</div>
                    <div class="article-sig-role">${post.authorRole}${partyHTML}</div>
                </div>
            </div>
            <div class="article-actions">
                <button class="action-item ${post.likes.includes(currentFeedCharId)?'liked':''}" onclick="event.stopPropagation(); toggleLike('${post._id}')"><i class="fa-solid fa-heart"></i> ${post.likes.length}</button>
                ${IS_ADMIN ? `<button class="action-item" onclick="event.stopPropagation(); openAdminStatsModal('${post._id}', ${post.likes.length})" title="Admin: modifier likes" style="color:var(--warning);"><i class="fa-solid fa-pen"></i></button>` : ''}
            </div>
        </div>`;
    return div;
}

function toggleHeadline(postId, value) {
    if(!IS_ADMIN) return;
    socket.emit('set_headline', { postId, value });
}

function loadPresse() { socket.emit('request_presse'); }

socket.on('presse_data', (articles) => {
    presseArticlesCache = articles;
    const c = document.getElementById('presse-stream'); 
    if(!c) return;
    c.innerHTML = '';
    if(articles.length === 0) {
        c.innerHTML = '<div style="text-align:center; padding:40px; color:#555;"><i class="fa-solid fa-newspaper" style="font-size:2.5rem; margin-bottom:12px; display:block;"></i>Aucun article publié.</div>';
        return;
    }
    articles.forEach(p => c.appendChild(createArticleElement(p)));
});

socket.on('new_article', (post) => {
    if(currentView === 'presse') {
        loadPresse();
    } else {
        document.getElementById('btn-view-presse').classList.add('nav-notify');
    }
});

// ==================== ACTUALITÉS ====================
function updateActuAdminForm() {
    const form = document.getElementById('actu-admin-form');
    if(form) { if(IS_ADMIN) form.classList.remove('hidden'); else form.classList.add('hidden'); }
    const dateInput = document.getElementById('actuDate');
    if(dateInput) { dateInput.max = new Date().toISOString().split('T')[0]; }
}
function loadActualites() { actuRequestPending = true; socket.emit('request_events'); }
function submitEvent() {
    const dateRaw = document.getElementById('actuDate').value;
    const heure = document.getElementById('actuHeure').value;
    const minuteEl = document.getElementById('actuMinute');
    const minute = minuteEl ? minuteEl.value : '00';
    const evenement = document.getElementById('actuEvenement').value.trim();
    if(!evenement) return;
    // Bloquer les dates dans le futur
    if(dateRaw) {
        const today = new Date(); today.setHours(23,59,59,999);
        const sel = new Date(dateRaw + 'T23:59:59');
        if(sel > today) return alert('Impossible de planifier un événement dans le futur.');
    }
    const heureFormatted = heure ? `${heure}h${minute}` : '';
    let dateFormatted = dateRaw;
    if(dateRaw) {
        const d = new Date(dateRaw + 'T12:00:00');
        if(!isNaN(d)) dateFormatted = d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
    }
    socket.emit('create_event', { jour: '', date: dateFormatted, heure: heureFormatted, evenement });
    document.getElementById('actuDate').value = '';
    document.getElementById('actuHeure').value = '';
    if(minuteEl) minuteEl.value = '00';
    document.getElementById('actuEvenement').value = '';
}
function deleteEvent(id) { if(confirm('Supprimer cet événement ?')) socket.emit('delete_event', id); }

socket.on('events_data', (events) => {
    // Show notification badge if this is a real-time push (not our own request)
    if (!actuRequestPending && currentView !== 'actualites') {
        const badge = document.getElementById('actu-badge');
        if(badge) badge.classList.remove('hidden');
        const btn = document.getElementById('btn-view-actualites');
        if(btn) btn.classList.add('nav-notify');
    }
    actuRequestPending = false;

    const c = document.getElementById('events-list'); if(!c) return;
    c.innerHTML = '';
    if(events.length === 0) {
        c.innerHTML = '<div class="actu-empty"><i class="fa-solid fa-calendar-xmark"></i><p>Aucun événement planifié.</p></div>';
        return;
    }
    // Sort: futurs/aujourd'hui en premier (asc = le plus proche d'abord), puis passé (desc = le plus récent d'abord)
    const parseEventDate = (d) => {
        if(!d) return 0;
        const p = d.split('/');
        if(p.length === 3) return new Date(p[2]+'-'+p[1]+'-'+p[0]).getTime();
        return new Date(d).getTime() || 0;
    };
    const todayMs = new Date(new Date().toDateString()).getTime();
    const futureEvts = events.filter(e => parseEventDate(e.date) >= todayMs);
    const pastEvts   = events.filter(e => parseEventDate(e.date) <  todayMs);
    futureEvts.sort((a, b) => { const d = parseEventDate(a.date)-parseEventDate(b.date); return d !== 0 ? d : (a.heure||'').localeCompare(b.heure||''); });
    pastEvts.sort((a, b) => { const d = parseEventDate(b.date)-parseEventDate(a.date); return d !== 0 ? d : (b.heure||'').localeCompare(a.heure||''); });
    const sortedEvents = [...futureEvts, ...pastEvts];
    eventsCache = sortedEvents.slice(0, 10);
    if(currentView === 'accueil') renderAccueil();
    let lastDate = null;
    sortedEvents.forEach(ev => {
        if(ev.date !== lastDate) {
            lastDate = ev.date;
            c.innerHTML += `<div class="actu-date-header"><span>${ev.jour ? ev.jour + ' · ' : ''}${ev.date}</span></div>`;
        }
        const delBtn = IS_ADMIN ? `<button class="actu-del-btn" onclick="deleteEvent('${ev._id}')"><i class="fa-solid fa-trash"></i></button>` : '';
        c.innerHTML += `
            <div class="actu-event-item">
                <div class="actu-time">${ev.heure || '—'}</div>
                <div class="actu-dot-line"><div class="actu-dot"></div><div class="actu-line"></div></div>
                <div class="actu-event-body">
                    <span class="actu-event-text">${escapeHtml(ev.evenement)}</span>
                    ${delBtn}
                </div>
            </div>`;
    });
});

// ==================== BANDEAU D'ALERTE GLOBAL [NOUVEAU] ====================
socket.on('alert_data', (alert) => {
    const banner = document.getElementById('global-alert-banner');
    if(!banner) return;
    document.getElementById('global-alert-text').textContent = alert.message;
    banner.className = `global-alert-banner alert-${alert.color}`;
    banner.classList.remove('hidden');
    document.body.setAttribute('data-alert', alert.color);
});
socket.on('alert_cleared', () => {
    const banner = document.getElementById('global-alert-banner');
    if(banner) banner.classList.add('hidden');
    document.body.removeAttribute('data-alert');
});
function dismissAlert() { document.getElementById('global-alert-banner').classList.add('hidden'); }

let selectedAlertColor = 'red';
function selectAlertColor(color) {
    selectedAlertColor = color;
    document.getElementById('alertColor').value = color;
    document.querySelectorAll('.alert-color-btn').forEach(b => b.classList.remove('active-alert-btn'));
    const btn = document.querySelector(`.alert-color-btn[data-color="${color}"]`);
    if(btn) btn.classList.add('active-alert-btn');
}
function submitAlert(active) {
    const message = document.getElementById('alertMessage').value.trim();
    socket.emit('admin_set_alert', { message, color: selectedAlertColor, active });
    document.getElementById('admin-alert-modal').classList.add('hidden');
}
function closeAdminAlertModal() { document.getElementById('admin-alert-modal').classList.add('hidden'); }

// [FIX] La logique admin-alert est désormais directement dans openUserSettingsModal ci-dessus

// ==================== CAPITAL ADMIN [NOUVEAU] ====================
function adminEditCapital(charId, currentCapital) {
    if(!IS_ADMIN) return;
    const val = prompt(`Capital actuel : ${Number(currentCapital).toLocaleString('fr-FR')} crédits\nNouveau capital :`, currentCapital);
    if(val !== null && !isNaN(parseFloat(val))) {
        socket.emit('admin_edit_capital', { charId, capital: parseFloat(val) });
    }
}

// ==================== MESSAGES CRYPTÉS [NOUVEAU] ====================
function simpleEncrypt(text, password) {
    let result = '';
    for(let i = 0; i < text.length; i++) {
        result += String.fromCharCode(text.charCodeAt(i) ^ password.charCodeAt(i % password.length));
    }
    return btoa(unescape(encodeURIComponent(result)));
}
function simpleDecrypt(encoded, password) {
    try {
        const text = decodeURIComponent(escape(atob(encoded)));
        let result = '';
        for(let i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ password.charCodeAt(i % password.length));
        }
        return result;
    } catch(e) { return null; }
}
function generateGlitch(text) {
    const glitchChars = '▓█▒░⣿⣶⣤⣀◆◇■□▪▫';
    return text.split('').map(() => glitchChars[Math.floor(Math.random() * glitchChars.length)]).join('');
}
function openCryptoModal() {
    if(!currentSelectedChar) return alert("Sélectionnez un personnage d'abord.");
    document.getElementById('cryptoContent').value = '';
    document.getElementById('cryptoPassword').value = '';
    document.getElementById('crypto-modal').classList.remove('hidden');
}
function closeCryptoModal() { document.getElementById('crypto-modal').classList.add('hidden'); }
function sendCryptoMessage() {
    const content = document.getElementById('cryptoContent').value.trim();
    const password = document.getElementById('cryptoPassword').value.trim();
    if(!content) return alert("Message vide.");
    if(!password) return alert("Mot de passe requis.");
    if(!currentSelectedChar) return alert("Perso requis !");
    const encrypted = simpleEncrypt(content, password);
    const glitch = generateGlitch(content.substring(0, 25));
    const payload = `[CRYPTO]${encrypted}|${glitch}[/CRYPTO]`;
    const baseMsg = { 
        senderName: currentSelectedChar.name, senderColor: currentSelectedChar.color || "#fff", 
        senderAvatar: currentSelectedChar.avatar, senderRole: currentSelectedChar.role, 
        partyName: currentSelectedChar.partyName || null, partyLogo: currentSelectedChar.partyLogo || null, 
        ownerId: PLAYER_ID, targetName: "", roomId: currentRoomId, 
        date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), replyTo: null 
    };
    socket.emit('message_rp', { ...baseMsg, content: payload, type: 'text' });
    closeCryptoModal();
}
function openDecryptModal(msgId, encryptedData) {
    document.getElementById('decryptMsgId').value = encryptedData;
    document.getElementById('decryptPassword').value = '';
    document.getElementById('decryptResult').innerHTML = '';
    document.getElementById('decrypt-modal').classList.remove('hidden');
}
function closeDecryptModal() { document.getElementById('decrypt-modal').classList.add('hidden'); }
function tryDecrypt() {
    const password = document.getElementById('decryptPassword').value.trim();
    const encrypted = document.getElementById('decryptMsgId').value;
    if(!password) return;
    const result = simpleDecrypt(encrypted, password);
    const resultEl = document.getElementById('decryptResult');
    if(result && result.length > 0) {
        resultEl.innerHTML = `<div style="background:var(--accent-muted);border:1px solid var(--accent);padding:10px;border-radius:var(--radius-sm);margin-top:8px;"><i class="fa-solid fa-unlock" style="color:var(--accent);"></i> <strong>Déchiffré :</strong><br>${escapeHtml(result)}</div>`;
    } else {
        resultEl.innerHTML = `<div style="color:var(--danger);margin-top:8px;"><i class="fa-solid fa-lock"></i> Mot de passe incorrect.</div>`;
    }
}

// ==================== CRÉATION PERSO — ENTREPRISES [NOUVEAU] ====================
let newCharCompanies = [];
async function addCompanyToNewChar() {
    const name = document.getElementById('newCompanyName').value.trim();
    const role = document.getElementById('newCompanyRole').value.trim();
    const logoFile = document.getElementById('newCompanyLogoFile').files[0];
    if(!name) return;
    let logo = null;
    if(logoFile) logo = await uploadToCloudinary(logoFile);
    newCharCompanies.push({ name, role: role || '', logo, description: '' });
    renderNewCharCompanies();
    document.getElementById('newCompanyName').value = '';
    document.getElementById('newCompanyRole').value = '';
    document.getElementById('newCompanyLogoFile').value = '';
}
function renderNewCharCompanies() {
    const list = document.getElementById('newCharCompaniesList');
    if(!list) return;
    list.innerHTML = newCharCompanies.map((co, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-tertiary);border-radius:var(--radius-sm);margin-bottom:5px;border:1px solid var(--border);">
            ${co.logo ? `<img src="${co.logo}" style="width:22px;height:22px;border-radius:4px;object-fit:cover;">` : '<i class="fa-solid fa-building" style="color:var(--text-muted);"></i>'}
            <span style="flex:1;font-size:0.82rem;font-weight:600;">${co.name}</span>
            <span style="font-size:0.72rem;color:var(--text-muted);">${co.role}</span>
            <button onclick="removeNewCharCompany(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.8rem;"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('');
}
function removeNewCharCompany(i) { newCharCompanies.splice(i, 1); renderNewCharCompanies(); }

// [NOUVEAU] Entreprises dans modification
let editCharCompanies = [];
async function addCompanyToEditChar() {
    const name = document.getElementById('editCompanyName').value.trim();
    const role = document.getElementById('editCompanyRole').value.trim();
    const logoFile = document.getElementById('editCompanyLogoFile').files[0];
    if(!name) return;
    let logo = null;
    if(logoFile) logo = await uploadToCloudinary(logoFile);
    editCharCompanies.push({ name, role: role || '', logo, description: '' });
    renderEditCharCompanies();
    document.getElementById('editCompanyName').value = '';
    document.getElementById('editCompanyRole').value = '';
    document.getElementById('editCompanyLogoFile').value = '';
}
function renderEditCharCompanies() {
    const list = document.getElementById('editCharCompaniesList');
    if(!list) return;
    list.innerHTML = editCharCompanies.map((co, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-tertiary);border-radius:var(--radius-sm);margin-bottom:5px;border:1px solid var(--border);">
            ${co.logo ? `<img src="${co.logo}" style="width:22px;height:22px;border-radius:4px;object-fit:cover;">` : '<i class="fa-solid fa-building" style="color:var(--text-muted);"></i>'}
            <span style="flex:1;font-size:0.82rem;font-weight:600;">${co.name}</span>
            <span style="font-size:0.72rem;color:var(--text-muted);">${co.role}</span>
            <button onclick="removeEditCharCompany(${i})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.8rem;"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('');
}
function removeEditCharCompany(i) { editCharCompanies.splice(i, 1); renderEditCharCompanies(); }

// ==================== [MES PERSONNAGES] ====================
function renderMesPersos() {
    const container = document.getElementById('mes-persos-list');
    if(!container) return;
    if(!myCharacters.length) {
        container.innerHTML = `<div class="mp-empty"><i class="fa-solid fa-user-slash"></i><p>Aucun personnage créé.</p><button class="btn-primary" onclick="openCharModal('create')"><i class="fa-solid fa-plus"></i> Créer un personnage</button></div>`;
        return;
    }
    container.innerHTML = '';
    myCharacters.forEach(char => {
        const card = document.createElement('div');
        card.className = 'mp-char-card';
        card.style.borderLeft = `4px solid ${char.color || 'var(--accent)'}`;
        const companies = char.companies || [];
        let compHTML = '';
        if (companies.length > 0) {
            const first = companies[0];
            compHTML = `<div class="mp-company-item">
                <div class="mp-company-logo-wrap">${first.logo ? `<img src="${first.logo}" class="mp-company-logo">` : '<i class="fa-solid fa-building"></i>'}</div>
                <div>
                    <div class="mp-company-name">${escapeHtml(first.name)}</div>
                    <div class="mp-company-role">${escapeHtml(first.role || '')}</div>
                    ${first.headquarters ? `<div class="mp-company-hq"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(first.headquarters)}</div>` : ''}
                    ${(first.revenue||0) > 0 ? `<div class="mp-company-revenue"><i class="fa-solid fa-coins"></i> CA : ${formatStockValue(first.revenue)}</div>` : ''}
                </div>
            </div>`;
            if (companies.length > 1) compHTML += `<div class="mp-companies-more">et ${companies.length - 1} autre${companies.length - 1 > 1 ? 's' : ''}</div>`;
        }
        const partyHTML = char.partyName ? `<div class="mp-char-party">${char.partyLogo ? `<img src="${char.partyLogo}" class="party-logo" style="width:14px;height:14px;">` : ''} ${escapeHtml(char.partyName)}</div>` : '';
        card.innerHTML = `
            <div class="mp-char-header">
                <img src="${char.avatar}" class="mp-char-avatar" onclick="openProfile('${char.name.replace(/'/g, "\\'")}')">
                <div class="mp-char-info">
                    <div class="mp-char-name" style="color:${char.color || 'white'}">${escapeHtml(char.name)}</div>
                    <div class="mp-char-role">${escapeHtml(char.role)}</div>
                    ${partyHTML}
                    ${char.description ? `<div class="mp-char-desc">${escapeHtml(char.description)}</div>` : ''}
                </div>
                <div class="mp-char-actions">
                    <button onclick="openProfile('${char.name.replace(/'/g, "\\'")}');" class="btn-mini-action" title="Profil"><i class="fa-solid fa-user"></i></button>
                    <button onclick="prepareEditCharacter('${char._id}')" class="btn-mini-action" title="Modifier"><i class="fa-solid fa-pen"></i></button>
                    <button onclick="deleteCharacter('${char._id}')" class="btn-mini-action" title="Supprimer" style="color:#da373c;"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            <div class="mp-char-stats">
                <div class="mp-stat"><span>${char.followers ? char.followers.length : 0}</span><span>Abonnés</span></div>
                <div class="mp-stat"><span>${char.capital ? formatStockValue(char.capital) : '0'}</span><span>Capital</span></div>
                <div class="mp-stat"><span>${companies.length}</span><span>Entreprise${companies.length !== 1 ? 's' : ''}</span></div>
            </div>
            ${companies.length ? `<div class="mp-char-companies"><div class="mp-section-label"><i class="fa-solid fa-building"></i> Entreprises</div><div class="mp-companies-list">${compHTML}</div></div>` : ''}
        `;
        container.appendChild(card);
    });
}

// ==================== [PUB BOOST] ====================
// Voir plus pour les bios
function setBioWithVoirPlus(elementId, text) {
    const el = document.getElementById(elementId);
    if(!el) return;
    el.innerHTML = '';
    if(!text) { el.textContent = 'Aucune description.'; return; }
    const MAX_CHARS = 240;
    if(text.length <= MAX_CHARS) { el.textContent = text; return; }
    const shortSpan = document.createElement('span');
    shortSpan.textContent = text.slice(0, MAX_CHARS);
    const dotsSpan = document.createElement('span');
    dotsSpan.textContent = '…';
    const fullSpan = document.createElement('span');
    fullSpan.style.display = 'none';
    fullSpan.textContent = text;
    const btn = document.createElement('button');
    btn.className = 'bio-voir-plus-btn';
    btn.textContent = 'Voir plus';
    btn.onclick = () => {
        const isExpanded = fullSpan.style.display !== 'none';
        shortSpan.style.display = isExpanded ? 'inline' : 'none';
        dotsSpan.style.display = isExpanded ? 'inline' : 'none';
        fullSpan.style.display = isExpanded ? 'none' : 'inline';
        btn.textContent = isExpanded ? 'Voir plus' : 'Voir moins';
    };
    el.appendChild(shortSpan);
    el.appendChild(dotsSpan);
    el.appendChild(fullSpan);
    el.appendChild(document.createElement('br'));
    el.appendChild(btn);
}

function adminSetCompanyRevenue(charId, companyName, currentRevenue) {
    if(!IS_ADMIN) return;
    const val = prompt(`Chiffre d'affaires — "${companyName}"\nActuel : ${Number(currentRevenue).toLocaleString('fr-FR')} cr\n\nNouveau CA :`, currentRevenue);
    if(val !== null && !isNaN(parseFloat(val))) {
        socket.emit('admin_set_company_revenue', { charId, companyName, revenue: parseFloat(val) });
    }
}

// ==================== [ACCUEIL] ====================
function renderAccueil() {
    // Derniers posts
    const feedPrev = document.getElementById('accueil-feed-preview');
    if(feedPrev) {
        if(feedPostsCache.length) {
            feedPrev.innerHTML = feedPostsCache.slice(0, 6).map(p => {
                const name = p.isAnonymous ? 'Anonyme' : escapeHtml(p.authorName);
                const rawText = (p.content||'').replace(/\[TITRE\](.*?)\[\/TITRE\]\n?/, '$1 — ');
                const text = rawText.slice(0, 90);
                const avatarSrc = p.isAnonymous ? '' : p.authorAvatar;
                return `<div class="accueil-post-item" onclick="switchView('feed')">
                    ${avatarSrc ? `<img src="${avatarSrc}" class="accueil-post-avatar" onerror="this.style.opacity=0">` : `<span class="accueil-post-avatar" style="background:var(--bg-tertiary);display:inline-flex;align-items:center;justify-content:center;font-size:0.8rem;color:var(--text-dim);flex-shrink:0;border-radius:50%;">?</span>`}
                    <div class="accueil-post-meta">
                        <span class="accueil-post-author" style="color:${p.isAnonymous?'#888':p.authorColor||'white'}">${name}</span>
                        <span class="accueil-post-content">${escapeHtml(text)}${rawText.length > 90 ? '…' : ''}</span>
                    </div>
                    <span class="accueil-post-date">${p.date}</span>
                </div>`;
            }).join('');
        } else {
            feedPrev.innerHTML = '<div class="accueil-widget-empty">Chargement…</div>';
        }
    }
    // Prochains événements
    const eventsPrev = document.getElementById('accueil-events-preview');
    if(eventsPrev) {
        if(eventsCache.length) {
            eventsPrev.innerHTML = eventsCache.slice(0, 5).map(ev => `
                <div class="accueil-event-item" onclick="switchView('actualites')">
                    ${ev.date ? `<div class="accueil-event-date">${ev.jour ? ev.jour+' · ' : ''}${ev.date}</div>` : ''}
                    <div class="accueil-event-main">
                        <span class="accueil-event-time">${ev.heure || ''}</span>
                        <span class="accueil-event-text">${escapeHtml(ev.evenement)}</span>
                    </div>
                </div>`).join('');
        } else {
            eventsPrev.innerHTML = '<div class="accueil-widget-empty">Aucun événement.</div>';
        }
    }
    // Bourse Top 5
    const stocksPrev = document.getElementById('accueil-stocks-preview');
    if(stocksPrev) {
        if(stocksData.length) {
            const top5 = [...stocksData].sort((a,b) => b.currentValue - a.currentValue).slice(0, 5);
            stocksPrev.innerHTML = top5.map(s => {
                const hist = s.history || [];
                const prev = hist.length >= 2 ? hist[hist.length-2].value : s.currentValue;
                const pct = prev ? ((s.currentValue - prev)/prev*100) : 0;
                const col = pct > 0 ? '#23a559' : pct < 0 ? '#da373c' : '#888';
                return `<div class="accueil-stock-item" onclick="switchView('bourse')">
                    ${s.companyLogo ? `<img src="${s.companyLogo}" class="accueil-stock-logo">` : `<span class="accueil-stock-icon"><i class="fa-solid fa-building"></i></span>`}
                    <div class="accueil-stock-info">
                        <span class="accueil-stock-name">${escapeHtml(s.companyName)}</span>
                        <span class="accueil-stock-char">${escapeHtml(s.charName||'')}</span>
                    </div>
                    <div class="accueil-stock-val-wrap">
                        <span class="accueil-stock-val">${formatStockValue(s.currentValue)}</span>
                        <span class="accueil-stock-pct" style="color:${col}">${pct>=0?'▲':'▼'} ${Math.abs(pct).toFixed(2)}%</span>
                    </div>
                </div>`;
            }).join('');
        } else {
            stocksPrev.innerHTML = '<div class="accueil-widget-empty">Aucune donnée bourse.</div>';
        }
    }
    // Mes personnages
    const charsPrev = document.getElementById('accueil-chars-preview');
    if(charsPrev) {
        if(myCharacters.length) {
            charsPrev.innerHTML = myCharacters.map(c =>
                `<div class="accueil-char-item" onclick="openProfile('${c.name.replace(/'/g,"\\'")}')">
                    <img src="${c.avatar}" class="accueil-char-avatar" style="border-color:${c.color||'var(--accent)'}">
                    <div class="accueil-char-info">
                        <span class="accueil-char-name" style="color:${c.color||'white'}">${escapeHtml(c.name)}</span>
                        <span class="accueil-char-role">${escapeHtml(c.role||'')}</span>
                    </div>
                    ${c.capital > 0 ? `<span class="accueil-char-capital">${formatStockValue(c.capital)}</span>` : ''}
                </div>`
            ).join('');
        } else {
            charsPrev.innerHTML = `<div class="accueil-widget-empty">Aucun personnage. <button class="btn-primary" onclick="openCharModal('create')" style="font-size:0.73rem;padding:4px 10px;margin-left:6px;"><i class="fa-solid fa-plus"></i> Créer</button></div>`;
        }
    }
}

function toggleFeedPubSelect() {    const cb = document.getElementById('postIsPub');
    const wrap = document.getElementById('feed-pub-stock-wrap');
    if(wrap) wrap.classList.toggle('hidden', !cb?.checked);
}
function togglePressePubSelect() {
    const cb = document.getElementById('presseIsPub');
    const wrap = document.getElementById('presse-pub-stock-wrap');
    if(wrap) wrap.classList.toggle('hidden', !cb?.checked);
}
function populatePubStockSelects() {
    ['postPubStockId', 'pressePubStockId'].forEach(selId => {
        const sel = document.getElementById(selId);
        if(!sel) return;
        const cur = sel.value;
        sel.innerHTML = '<option value="">— Choisir une action —</option>';
        stocksData.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s._id;
            opt.textContent = s.companyName;
            sel.appendChild(opt);
        });
        if(cur) sel.value = cur;
    });
}

// ==================== [CITÉS] SYSTÈME GÉOPOLITIQUE ====================

let citiesData = [];      // cache local
let currentCityId = null; // cité ouverte dans le panneau
let prevEdcRanks = {};    // cityId → rang EDC (pour les flèches)
let prevPopRanks = {};    // cityId → rang Population

// --- Formatage abrégé (cartes + stats) ---
// EDC : en MMd (milliers de milliards = 10^12) ou Md (milliards = 10^9)
function formatEDC(value) {
    if(value == null) return '—';
    const abs = Math.abs(value);
    if(abs >= 1e15)       return `${(value/1e15).toLocaleString('fr-FR',{maximumFractionDigits:2})} Qd`;   // quadrillions
    if(abs >= 1e12)       return `${(value/1e12).toLocaleString('fr-FR',{maximumFractionDigits:2})} MMd`;  // milliers de milliards
    if(abs >= 1e9)        return `${(value/1e9).toLocaleString('fr-FR',{maximumFractionDigits:2})} Md`;    // milliards
    if(abs >= 1e6)        return `${(value/1e6).toLocaleString('fr-FR',{maximumFractionDigits:2})} M`;     // millions
    return value.toLocaleString('fr-FR', {maximumFractionDigits:0});
}

// EDC valeur entière complète (panneau de détail)
function formatEDCFull(value) {
    if(value == null) return '—';
    return Math.round(value).toLocaleString('fr-FR');
}

// Population avec abréviations : 175 100 000 → 175,1 M
function formatPop(value) {
    if(value == null) return '—';
    const abs = Math.abs(value);
    if(abs >= 1e9)  return `${(value/1e9).toLocaleString('fr-FR',{maximumFractionDigits:2})} Md`;
    if(abs >= 1e6)  return `${(value/1e6).toLocaleString('fr-FR',{maximumFractionDigits:1})} M`;
    if(abs >= 1e3)  return `${(value/1e3).toLocaleString('fr-FR',{maximumFractionDigits:1})} k`;
    return Math.round(value).toLocaleString('fr-FR');
}

function calcEDCEvolution(historyEDC) {
    if(!historyEDC || historyEDC.length < 2) return null;
    const recent = historyEDC.slice(-7);
    const oldest = recent[0].value;
    const newest = recent[recent.length - 1].value;
    if(!oldest) return null;
    return ((newest - oldest) / oldest) * 100;
}

function trendLabel(trend) {
    return { croissance_forte:'📈 Croissance Forte', croissance:'↗ Croissance', stable:'→ Stable', baisse:'↘ Baisse', chute:'📉 Chute Libre' }[trend] || '→ Stable';
}
function trendClass(trend) {
    if(!trend || trend === 'stable') return 'trend-neutral';
    if(trend === 'croissance_forte' || trend === 'croissance') return 'trend-positive';
    return 'trend-negative';
}

// --- Charger ---
function loadCities() { socket.emit('request_cities'); }

socket.on('cities_data', (cities) => {
    citiesData = cities;
    renderCitiesGrid(cities);
    renderCitiesRankings(cities);
    if(currentCityId) {
        const updated = cities.find(c => c._id === currentCityId);
        if(updated) renderCityDetailContent(updated);
    }
});

// --- Grille ---
function renderCitiesGrid(cities) {
    const container = document.getElementById('cites-grid-container');
    if(!container) return;
    container.innerHTML = '';
    const ARCHIPORDER = ['Archipel Pacifique', 'Ancienne Archipel', 'Archipel Sableuse'];
    const groups = {};
    cities.forEach(c => { if(!groups[c.archipel]) groups[c.archipel] = []; groups[c.archipel].push(c); });

    ARCHIPORDER.forEach(archip => {
        const group = groups[archip]; if(!group || !group.length) return;
        const section = document.createElement('div');
        section.className = 'cites-section';
        section.innerHTML = `<div class="cites-section-title">${archip}</div>`;
        const grid = document.createElement('div');
        grid.className = 'cites-grid';

        group.forEach(city => {
            const evol = calcEDCEvolution(city.historyEDC);
            const evolHTML = evol !== null
                ? `<span class="city-card-evol ${evol >= 0 ? 'evol-pos' : 'evol-neg'}">${evol >= 0 ? '▲ +' : '▼ '}${evol.toFixed(1)}%</span>`
                : '';
            const flagHTML = city.flag ? `<img src="${city.flag}" class="city-card-flag" alt="drapeau">` : '';
            const card = document.createElement('div');
            card.className = `city-card ${trendClass(city.trend)}`;
            card.onclick = () => openCityDetail(city);
            card.innerHTML = `
                ${flagHTML}
                <div class="city-card-name">${city.name}</div>
                <div class="city-card-edc-row">
                    <span class="city-card-edc-label">EDC</span>
                    <span class="city-card-edc-value">${formatEDC(city.baseEDC)}</span>
                    ${evolHTML}
                </div>
                <div class="city-card-pop"><i class="fa-solid fa-users"></i> ${formatPop(city.population)}</div>
                <div class="city-card-trend ${trendClass(city.trend)}">${trendLabel(city.trend)}</div>`;
            grid.appendChild(card);
        });
        section.appendChild(grid);
        container.appendChild(section);
    });
}

// --- Panneau détail ---
function openCityDetail(city) {
    currentCityId = city._id;
    document.getElementById('city-detail-overlay').classList.remove('hidden');
    document.getElementById('city-detail-overlay').onclick = closeCityDetail;
    document.getElementById('city-detail-panel').classList.add('open');
    renderCityDetailContent(city);
}

function renderCityDetailContent(city) {
    // Hero
    document.getElementById('cityDetailName').textContent = city.name;
    document.getElementById('cityDetailArchipel').textContent = city.archipel;
    const heroEl = document.getElementById('cityDetailHero');
    heroEl.className = `city-hero city-hero-${trendClass(city.trend)}`;

    // Drapeau
    const flagEl = document.getElementById('cityDetailFlag');
    if(flagEl) { flagEl.src = city.flag || ''; flagEl.style.display = city.flag ? 'block' : 'none'; }

    // Stats
    document.getElementById('cityDetailPop').textContent = formatPop(city.population);
    // EDC : valeur abrégée + valeur entière en dessous
    const edcEl = document.getElementById('cityDetailEDC');
    edcEl.innerHTML = `${formatEDC(city.baseEDC)}<div class="city-edc-full">${formatEDCFull(city.baseEDC)}</div>`;
    document.getElementById('cityDetailPresident').textContent = city.president || 'Vacant';
    const trendEl = document.getElementById('cityDetailTrend');
    trendEl.textContent = trendLabel(city.trend);
    trendEl.className = `city-stat-value ${trendClass(city.trend)}`;

    // Capitale
    const capitaleEl = document.getElementById('cityDetailCapitale');
    if(capitaleEl) capitaleEl.textContent = city.capitale || 'Non définie';

    // Évolution 7j
    const evol = calcEDCEvolution(city.historyEDC);
    const evolEl = document.getElementById('cityDetailEvol');
    if(evol !== null) {
        evolEl.textContent = `${evol >= 0 ? '▲ +' : '▼ '}${evol.toFixed(2)}% sur 7 valeurs`;
        evolEl.className = `city-edc-evol ${evol >= 0 ? 'evol-pos' : 'evol-neg'}`;
    } else {
        evolEl.textContent = 'Données insuffisantes'; evolEl.className = 'city-edc-evol trend-neutral';
    }

    // Bar chart
    renderCityMiniChart(city.historyEDC);

    // Admin panel
    const adminPanel = document.getElementById('cityAdminPanel');
    if(IS_ADMIN) {
        adminPanel.classList.remove('hidden');
        document.getElementById('adminCityId').value = city._id;
        document.getElementById('adminCityPresident').value = city.president || '';
        document.getElementById('adminCityCapitale').value = city.capitale || '';
        document.getElementById('adminCityPop').value = city.population || '';
        document.getElementById('adminCityEDC').value = city.baseEDC || '';
        // Préview drapeau admin
        const prevFlag = document.getElementById('adminFlagPreview');
        if(prevFlag) { prevFlag.src = city.flag || ''; prevFlag.style.display = city.flag ? 'block' : 'none'; }
        // Reset save message
        const saveMsg = document.getElementById('cityAdminSaveMsg');
        if(saveMsg) saveMsg.classList.add('hidden');
    } else {
        adminPanel.classList.add('hidden');
    }
}

function closeCityDetail() {
    document.getElementById('city-detail-overlay').classList.add('hidden');
    document.getElementById('city-detail-panel').classList.remove('open');
    currentCityId = null;
}

function renderCityMiniChart(historyEDC) {
    const chart = document.getElementById('cityEDCChart');
    if(!chart) return;
    const data = (historyEDC || []).slice(-7);
    if(!data.length) { chart.innerHTML = '<span style="color:var(--text-muted);font-size:0.78rem;">Aucun historique.</span>'; return; }
    const maxVal = Math.max(...data.map(d => d.value));
    const minVal = Math.min(...data.map(d => d.value));
    const range = maxVal - minVal || 1;
    chart.style.overflow = 'visible';
    chart.innerHTML = data.map((d, i) => {
        const pct = Math.max(10, ((d.value - minVal) / range) * 100);
        const isLast = i === data.length - 1;
        const dateStr = d.date ? new Date(d.date).toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit'}) : `J-${data.length - 1 - i}`;
        return `<div class="chart-bar-wrap" data-value="${formatEDC(d.value)}" data-full="${formatEDCFull(d.value)}" data-date="${dateStr}">
            <div class="chart-bar ${isLast ? 'chart-bar-last' : ''}" style="height:${pct}%"></div>
            <div class="chart-bar-label">${dateStr}</div>
            <div class="chart-bar-tooltip">${formatEDC(d.value)}</div>
        </div>`;
    }).join('');
}

// --- Classements ---
function resetRankEvolutions() {
    prevEdcRanks = {};
    prevPopRanks = {};
    if(citiesData.length) renderCitiesRankings(citiesData);
    const btn = document.getElementById('btn-reset-rank-evol');
    if(btn) {
        btn.textContent = '\u2705 Réinitialisé';
        btn.style.color = '#23a559';
        setTimeout(() => { btn.textContent = '\u21ba Réinit. évolutions'; btn.style.color = ''; }, 2000);
    }
}

function renderCitiesRankings(cities) {
    const byEdc = [...cities].filter(c => c.baseEDC != null).sort((a, b) => b.baseEDC - a.baseEDC);
    const byPop = [...cities].filter(c => c.population != null).sort((a, b) => b.population - a.population);

    // Nouveaux rangs
    const newEdcRanks = {};
    byEdc.forEach((city, i) => { newEdcRanks[city._id] = i + 1; });
    const newPopRanks = {};
    byPop.forEach((city, i) => { newPopRanks[city._id] = i + 1; });

    function rankArrow(prevRanks, cityId, currentRank) {
        const prev = prevRanks[cityId];
        if(prev == null || prev === currentRank) return '';
        const diff = prev - currentRank;
        if(diff > 0) return `<span class="rank-arrow rank-up">▲ +${diff}</span>`;
        return `<span class="rank-arrow rank-down">▼ ${Math.abs(diff)}</span>`;
    }

    function rankNumClass(rank) {
        if(rank === 1) return 'rank-n1';
        if(rank === 2) return 'rank-n2';
        if(rank === 3) return 'rank-n3';
        return 'rank-n';
    }

    function buildRow(city, rank, prevRanks, valueHTML) {
        const flagHTML = city.flag ? `<img src="${city.flag}" class="rank-flag" alt="">` : '<span class="rank-flag-ph"></span>';
        const arrow = rankArrow(prevRanks, city._id, rank);
        return `<div class="rank-row" style="animation-delay:${rank * 0.04}s">
            <span class="rank-num ${rankNumClass(rank)}">${rank}</span>
            ${flagHTML}
            <span class="rank-name">${city.name}</span>
            ${arrow}
            <span class="rank-value">${valueHTML}</span>
        </div>`;
    }

    const edcEl = document.getElementById('ranking-edc');
    if(edcEl) edcEl.innerHTML = byEdc.length
        ? byEdc.map((city, i) => buildRow(city, i + 1, prevEdcRanks, formatEDC(city.baseEDC))).join('')
        : '<div class="rank-empty">Aucune donnée.</div>';

    const popEl = document.getElementById('ranking-pop');
    if(popEl) popEl.innerHTML = byPop.length
        ? byPop.map((city, i) => buildRow(city, i + 1, prevPopRanks, formatPop(city.population))).join('')
        : '<div class="rank-empty">Aucune donnée.</div>';

    // Mémoriser les rangs actuels pour la prochaine mise à jour
    prevEdcRanks = newEdcRanks;
    prevPopRanks = newPopRanks;
}

// --- Admin actions ---
function adminSaveCityInfo() {
    const id        = document.getElementById('adminCityId').value;
    const president = document.getElementById('adminCityPresident').value.trim() || null;
    const capitale  = document.getElementById('adminCityCapitale').value.trim() || null;
    const pop       = document.getElementById('adminCityPop').value;
    const edc       = document.getElementById('adminCityEDC').value;
    socket.emit('admin_update_city', {
        cityId: id,
        president,
        capitale,
        population: pop ? Number(pop) : null,
        baseEDC:    edc ? Number(edc) : null
    });
}

socket.on('city_save_success', () => {
    const msg = document.getElementById('cityAdminSaveMsg');
    if(msg) {
        msg.classList.remove('hidden');
        msg.style.animation = 'none';
        void msg.offsetWidth;
        msg.style.animation = 'fadeInUp 0.3s ease';
        clearTimeout(msg._hideTimer);
        msg._hideTimer = setTimeout(() => msg.classList.add('hidden'), 3000);
    }
});

function adminApplyTrend(trend) {
    const id = document.getElementById('adminCityId').value;
    if(!id) return;
    socket.emit('admin_update_city', { cityId: id, trend });
}

// Appliquer un pourcentage personnalisé (entre -100 et +100, décimales autorisées)
function adminApplyCustomPct() {
    const id  = document.getElementById('adminCityId').value;
    const pct = parseFloat(document.getElementById('adminCustomPct').value);
    if(!id) return;
    if(isNaN(pct) || pct < -100 || pct > 100) return alert('Entrez un pourcentage entre -100 et 100 (décimales acceptées).');
    socket.emit('admin_update_city', { cityId: id, customPct: pct });
}

// Upload drapeau (Cloudinary)
async function adminUploadFlag() {
    const input = document.getElementById('adminFlagFile');
    if(!input || !input.files || !input.files[0]) return alert('Choisissez une image.');
    const btn = document.getElementById('adminFlagUploadBtn');
    if(btn) btn.textContent = '⏳ Upload...';
    const url = await uploadToCloudinary(input.files[0]);
    if(btn) btn.textContent = '📤 Uploader';
    if(!url) return alert('Échec upload');
    const id = document.getElementById('adminCityId').value;
    const prevFlag = document.getElementById('adminFlagPreview');
    if(prevFlag) { prevFlag.src = url; prevFlag.style.display = 'block'; }
    socket.emit('admin_update_city', { cityId: id, flag: url });
    input.value = '';
}
// ==================== [FIN CITÉS] ====================

// ==================== [BOURSE] ====================
let stocksData = [];
let currentStockEdit = null;
let currentStockDetailId = null;

function loadBourse() { socket.emit('request_stocks'); }

function updateBourseAdminUI() {
    const adminHeader = document.getElementById('bourse-admin-header');
    if(adminHeader) { if(IS_ADMIN) adminHeader.classList.remove('hidden'); else adminHeader.classList.add('hidden'); }
}

function formatStockValue(v) {
    if(v == null) return '—';
    if(v >= 1e9) return (v/1e9).toLocaleString('fr-FR', {maximumFractionDigits:2}) + ' Md';
    if(v >= 1e6) return (v/1e6).toLocaleString('fr-FR', {maximumFractionDigits:2}) + ' M';
    if(v >= 1e3) return (v/1e3).toLocaleString('fr-FR', {maximumFractionDigits:1}) + ' k';
    return v.toLocaleString('fr-FR', {maximumFractionDigits:2});
}

socket.on('stocks_data', (stocks) => {
    stocksData = stocks;
    renderStockTicker(stocks);
    renderStockGrid(stocks);
    renderBourseSummary(stocks);
    renderBourseCompChart(stocks);
    updateBourseCustomSelect(stocks);
    updateBourseAdminUI();
    populatePubStockSelects();
});
socket.on('stocks_updated', (stocks) => {
    stocksData = stocks;
    renderStockTicker(stocks);
    renderStockGrid(stocks);
    renderBourseSummary(stocks);
    renderBourseCompChart(stocks);
    updateBourseCustomSelect(stocks);
    populatePubStockSelects();
});

function renderStockTicker(stocks) {
    const ticker = document.getElementById('bourse-ticker');
    if(!ticker) return;
    if(!stocks.length) { ticker.innerHTML = '<span style="color:var(--text-muted);font-size:0.75rem;padding:0 16px;">Aucune action cotée.</span>'; return; }
    const items = stocks.map(s => {
        const hist = s.history || [];
        const prev = hist.length >= 2 ? hist[hist.length - 2].value : s.currentValue;
        const pct = prev ? ((s.currentValue - prev) / prev * 100) : 0;
        const color = pct > 0 ? '#23a559' : pct < 0 ? '#da373c' : '#888';
        const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '—';
        const logoHTML = s.companyLogo
            ? `<span class="ticker-logo-wrap"><img src="${s.companyLogo}" class="ticker-logo" alt=""><div class="ticker-logo-popup"><img src="${s.companyLogo}" alt="${escapeHtml(s.companyName)}"></div></span>`
            : '';
        return `<span class="ticker-item">
            ${logoHTML}
            <span class="ticker-name">${escapeHtml(s.companyName)}</span>
            <span class="ticker-value">${formatStockValue(s.currentValue)}</span>
            <span class="ticker-change" style="color:${color}">${arrow} ${Math.abs(pct).toFixed(2)}%</span>
        </span>`;
    }).join('<span class="ticker-sep">·</span>');
    ticker.innerHTML = items + '<span class="ticker-sep" style="margin:0 20px">·</span>' + items;
}

function renderBourseSummary(stocks) {
    const row = document.getElementById('bourse-summary-row');
    if(!row) return;
    if(!stocks.length) { row.innerHTML = ''; return; }
    const totalCap = stocks.reduce((s, st) => s + (st.currentValue || 0), 0);
    const winners = stocks.filter(s => {
        const hist = s.history || [];
        const prev = hist.length >= 2 ? hist[hist.length - 2].value : s.currentValue;
        return prev && s.currentValue > prev;
    }).length;
    const losers = stocks.filter(s => {
        const hist = s.history || [];
        const prev = hist.length >= 2 ? hist[hist.length - 2].value : s.currentValue;
        return prev && s.currentValue < prev;
    }).length;
    const bestStock = [...stocks].sort((a, b) => {
        const pH = (st) => { const h = st.history||[]; const p = h.length>=2?h[h.length-2].value:st.currentValue; return p?((st.currentValue-p)/p*100):0; };
        return pH(b) - pH(a);
    })[0];
    row.innerHTML = `
        <div class="bourse-summary-card">
            <div class="bourse-summary-label"><i class="fa-solid fa-landmark"></i> Capitalisation totale</div>
            <div class="bourse-summary-value">${formatStockValue(totalCap)}</div>
            <div class="bourse-summary-sub">${stocks.length} action${stocks.length>1?'s':''} cotée${stocks.length>1?'s':''}</div>
        </div>
        <div class="bourse-summary-card" style="border-color:rgba(35,165,89,0.3)">
            <div class="bourse-summary-label" style="color:#23a559"><i class="fa-solid fa-arrow-trend-up"></i> Hausse</div>
            <div class="bourse-summary-value" style="color:#23a559">${winners}</div>
            <div class="bourse-summary-sub">actions en progression</div>
        </div>
        <div class="bourse-summary-card" style="border-color:rgba(218,55,60,0.3)">
            <div class="bourse-summary-label" style="color:#da373c"><i class="fa-solid fa-arrow-trend-down"></i> Baisse</div>
            <div class="bourse-summary-value" style="color:#da373c">${losers}</div>
            <div class="bourse-summary-sub">actions en recul</div>
        </div>
        ${bestStock ? (() => {
            const hist = bestStock.history||[];
            const prev = hist.length>=2?hist[hist.length-2].value:bestStock.currentValue;
            const pct = prev?((bestStock.currentValue-prev)/prev*100):0;
            return `<div class="bourse-summary-card" style="border-color:rgba(108,99,255,0.3)">
                <div class="bourse-summary-label" style="color:var(--accent)"><i class="fa-solid fa-trophy"></i> Meilleure perf.</div>
                <div class="bourse-summary-value" style="font-size:0.9rem;">${escapeHtml(bestStock.companyName)}</div>
                <div class="bourse-summary-sub" style="color:#23a559">▲ +${pct.toFixed(2)}%</div>
            </div>`;
        })() : ''}
    `;
}

function renderStockGrid(stocks) {
    const grid = document.getElementById('bourse-stocks-grid');
    if(!grid) return;
    if(!stocks.length) {
        grid.innerHTML = '<div class="bourse-empty"><i class="fa-solid fa-chart-line"></i><p>Aucune action cotée.</p><span>Un admin peut coter les entreprises des personnages.</span></div>';
        return;
    }
    grid.innerHTML = '';
    stocks.forEach((s, idx) => {
        const hist = s.history || [];
        const prev = hist.length >= 2 ? hist[hist.length - 2].value : s.currentValue;
        const pct = prev ? ((s.currentValue - prev) / prev * 100) : 0;
        const isUp = pct > 0, isDown = pct < 0;
        const hist7 = hist.slice(-7);
        const hi7 = hist7.length ? Math.max(...hist7.map(h => h.value)) : null;
        const lo7 = hist7.length ? Math.min(...hist7.map(h => h.value)) : null;
        const card = document.createElement('div');
        card.className = `stock-card ${isUp ? 'stock-up' : isDown ? 'stock-down' : 'stock-neutral'}`;
        card.id = `stock-${s._id}`;
        card.style.animationDelay = `${idx * 0.05}s`;
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => openStockDetail(String(s._id)));

        const adminBtns = IS_ADMIN ? `
            <div class="stock-admin-row">
                <button class="stock-trend-btn stock-trend-up2" onclick="event.stopPropagation(); adminStockTrend('${s._id}','croissance_forte')" title="+1.3~1.6%"><i class="fa-solid fa-angles-up"></i></button>
                <button class="stock-trend-btn stock-trend-up1" onclick="event.stopPropagation(); adminStockTrend('${s._id}','croissance')" title="+0.5~0.9%"><i class="fa-solid fa-angle-up"></i></button>
                <button class="stock-trend-btn stock-trend-stable" onclick="event.stopPropagation(); adminStockTrend('${s._id}','stable')" title="±0.1%"><i class="fa-solid fa-minus"></i></button>
                <button class="stock-trend-btn stock-trend-down1" onclick="event.stopPropagation(); adminStockTrend('${s._id}','baisse')" title="-0.5~0.9%"><i class="fa-solid fa-angle-down"></i></button>
                <button class="stock-trend-btn stock-trend-down2" onclick="event.stopPropagation(); adminStockTrend('${s._id}','chute')" title="-1.2~1.6%"><i class="fa-solid fa-angles-down"></i></button>
                <input type="number" id="cpct-${s._id}" class="stock-pct-input" placeholder="%" step="0.1" onclick="event.stopPropagation()" onkeydown="if(event.key==='Enter'){event.stopPropagation();applyCustomPctCard('${s._id}');}">
                <button class="stock-trend-btn" onclick="event.stopPropagation(); applyCustomPctCard('${s._id}')" title="Appliquer %" style="background:rgba(108,99,255,0.2);color:var(--accent);border-color:rgba(108,99,255,0.3);"><i class="fa-solid fa-percent"></i></button>
                <button class="stock-trend-btn stock-admin-reset" onclick="event.stopPropagation(); if(confirm('Réinitialiser l\'historique de cette action ?')) adminResetStockHistory('${s._id}')" title="Réinitialiser l'historique"><i class="fa-solid fa-clock-rotate-left"></i></button>
                <button class="stock-admin-edit" onclick="event.stopPropagation(); openStockEditModal('${s._id}')" title="Modifier"><i class="fa-solid fa-pen"></i></button>
                <button class="stock-admin-del" onclick="event.stopPropagation(); if(confirm('Supprimer cette action ?')) adminDeleteStock('${s._id}')" title="Supprimer"><i class="fa-solid fa-trash"></i></button>
            </div>` : '';

        card.innerHTML = `
            <div class="stock-header">
                <div class="stock-logo-wrap" style="border-color:${s.stockColor||'var(--accent)'}">
                    ${s.companyLogo ? `<img src="${s.companyLogo}" class="stock-logo" alt="">` : `<i class="fa-solid fa-building"></i>`}
                    ${s.companyLogo ? `<div class="stock-logo-popup"><img src="${s.companyLogo}" alt="${escapeHtml(s.companyName)}"></div>` : ''}
                </div>
                <div class="stock-info">
                    <div class="stock-name">${escapeHtml(s.companyName)}</div>
                    <div class="stock-char" style="color:${s.charColor||'var(--text-muted)'}"><i class="fa-solid fa-user"></i> ${escapeHtml(s.charName||'')}${s.headquarters ? ` <span class="stock-hq"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(s.headquarters)}</span>` : ''}</div>
                </div>
                <div class="stock-badge ${isUp ? 'badge-up' : isDown ? 'badge-down' : 'badge-neutral'}">
                    ${isUp ? '▲' : isDown ? '▼' : '—'} ${Math.abs(pct).toFixed(2)}%
                </div>
            </div>
            <div class="stock-value-row">
                <span class="stock-current-value" style="color:${isUp?'#23a559':isDown?'#da373c':'white'}">${formatStockValue(s.currentValue)}</span>
                <span class="stock-prev-value">Préc: ${formatStockValue(prev)}</span>
            </div>
            ${(hi7 !== null && lo7 !== null) ? `<div class="stock-highlow-row"><span class="stock-low7"><i class="fa-solid fa-arrow-down"></i> ${formatStockValue(lo7)}</span><span class="stock-hl-label">7j bas/haut</span><span class="stock-high7"><i class="fa-solid fa-arrow-up"></i> ${formatStockValue(hi7)}</span></div>` : ''}
            <div class="stock-chart-container" id="schart-${s._id}"></div>
            ${s.description ? `<div class="stock-desc">${escapeHtml(s.description)}</div>` : ''}
            <div class="stock-trend-badge ${trendClass(s.trend)}">${trendLabel(s.trend)}</div>
            ${adminBtns}
        `;
        grid.appendChild(card);
        renderStockMiniChart(hist.slice(-7), s.currentValue, `schart-${s._id}`, s.stockColor || '#6c63ff', pct >= 0);
    });
}

function renderStockMiniChart(history, liveValue, containerId, color, isUp) {
    const container = document.getElementById(containerId);
    if(!container) return;
    // Build display data: committed history + optional live (pending) point
    let displayData = [...(history || [])];
    const lastHistVal = displayData.length > 0 ? displayData[displayData.length - 1].value : null;
    const hasLive = liveValue != null;
    // Ajouter toujours un point "en direct" pour montrer la valeur actuelle
    if(hasLive && (lastHistVal === null || Math.abs(liveValue - lastHistVal) > 0.001)) {
        displayData = [...displayData, { value: liveValue, live: true }];
    } else if(hasLive && displayData.length > 0) {
        // Même valeur : marquer le dernier point comme "actuel"
        displayData = [...displayData.slice(0, -1), { ...displayData[displayData.length - 1], live: true }];
    }

    if(!displayData || displayData.length < 2) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:0.7rem;text-align:center;padding:8px 0;">Données insuffisantes</div>';
        return;
    }
    const vals = displayData.map(d => d.value);
    const maxV = Math.max(...vals);
    const minV = Math.min(...vals);
    const range = maxV - minV || 1;
    const W = 240, H = 52;
    const pts = displayData.map((d, i) => ({
        x: parseFloat(((i / (displayData.length - 1)) * (W - 4) + 2).toFixed(1)),
        y: parseFloat((H - 3 - ((d.value - minV) / range) * (H - 10)).toFixed(1)),
        value: d.value, date: d.date, live: d.live
    }));
    const lineColor = isUp ? '#23a559' : '#da373c';
    const uid = containerId.replace(/[^a-z0-9]/gi, '');
    const committedPts = hasLive ? pts.slice(0, -1) : pts;
    const committedStr = committedPts.map(p => `${p.x},${p.y}`).join(' ');
    const livePt = hasLive ? pts[pts.length - 1] : null;
    const prevPt = hasLive ? pts[pts.length - 2] : null;
    container.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" class="stock-svg-chart" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;">
            <defs>
                <linearGradient id="sg-${uid}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.25"/>
                    <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <path d="M${committedStr} L${(W-2)},${H} L2,${H} Z" fill="url(#sg-${uid})"/>
            <polyline points="${committedStr}" fill="none" stroke="${lineColor}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
            ${hasLive && prevPt ? `<line x1="${prevPt.x}" y1="${prevPt.y}" x2="${livePt.x}" y2="${livePt.y}" stroke="${lineColor}" stroke-width="1.5" stroke-dasharray="3,3" opacity="0.75"/>` : ''}
            ${pts.map(p => {
                const dateStr = p.date ? new Date(p.date).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}) : 'Live';
                if(p.live) return `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${lineColor}" stroke="var(--bg-secondary)" stroke-width="1.5"><animate attributeName="r" values="3;5.5;3" dur="1.8s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0.5;1" dur="1.8s" repeatCount="indefinite"/><title>En direct — ${formatStockValue(p.value)}</title></circle>`;
                return `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${lineColor}" stroke="var(--bg-secondary)" stroke-width="1.5" class="stock-chart-dot"><title>${dateStr} — ${formatStockValue(p.value)}</title></circle>`;
            }).join('')}
        </svg>`;
}

// Graphique comparatif top 10
function renderBourseCompChart(stocks) {
    const container = document.getElementById('bourse-comp-chart');
    if(!container) return;
    const top10 = [...stocks]
        .filter(s => s.history && s.history.length >= 2)
        .sort((a, b) => b.currentValue - a.currentValue)
        .slice(0, 10);
    if(top10.length < 2) {
        container.innerHTML = '';
        return;
    }
    const W = 600, H = 80, xPad = 60, yPad = 8;
    const chartW = W - xPad * 2, chartH = H - yPad * 2;
    const maxPts = 7;
    // Collect all history values for Y scale
    let allVals = [];
    const lines = top10.map(s => {
        const hist = (s.history || []).slice(-maxPts);
        const vals = hist.map(h => h.value);
        allVals.push(...vals);
        return { name: s.companyName, color: s.stockColor || '#6c63ff', vals, hist };
    });
    const maxVal = Math.max(...allVals, 1);
    const minVal = Math.min(...allVals, 0);
    const valRange = maxVal - minVal || 1;
    const linesSVG = lines.map(line => {
        if(line.vals.length < 2) return '';
        const pts = line.vals.map((v, i) => {
            const x = xPad + (i / Math.max(line.vals.length - 1, 1)) * chartW;
            const y = yPad + chartH - ((v - minVal) / valRange) * chartH;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        return `<polyline points="${pts}" fill="none" stroke="${line.color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" opacity="0.88"/>`;
    }).join('');
    // Y axis labels: 3 ticks (min, mid, max)
    const ticks = [minVal, (minVal + maxVal) / 2, maxVal];
    const gridLines = ticks.map(v => {
        const y = yPad + chartH - ((v - minVal) / valRange) * chartH;
        return `<line x1="${xPad}" y1="${y.toFixed(1)}" x2="${W-xPad}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.09)" stroke-width="1" stroke-dasharray="3,3"/>
        <text x="${xPad-5}" y="${(y+3.5).toFixed(1)}" fill="rgba(255,255,255,0.35)" font-size="8" text-anchor="end">${formatStockValue(v)}</text>`;
    }).join('');
    const legendHTML = lines.map(l =>
        `<span class="bourse-comp-legend-item"><span class="bourse-comp-legend-dot" style="background:${l.color}"></span>${escapeHtml(l.name)}</span>`
    ).join('');
    container.innerHTML = `
        <div class="bourse-comp-header">
            <div class="bourse-section-title"><i class="fa-solid fa-chart-mixed"></i> Top 10 — Performance comparative (7 dernières valeurs)</div>
        </div>
        <svg viewBox="0 0 ${W} ${H}" class="bourse-comp-svg" xmlns="http://www.w3.org/2000/svg">
            ${gridLines}
            ${linesSVG}
        </svg>
        <div class="bourse-comp-legend">${legendHTML}</div>`;
}

function updateBourseCustomSelect(stocks) {    const sel = document.getElementById('bourseCustomStockId');
    if(!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">— Choisir une action —</option>';
    stocks.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s._id;
        opt.textContent = `${s.companyName} (${s.charName||''})`;
        sel.appendChild(opt);
    });
    if(currentVal) sel.value = currentVal;
}

// Admin — Modal ajout/modif stock
function openStockAddModal() {
    currentStockEdit = null;
    document.getElementById('bourseStockId').value = '';
    document.getElementById('bourseStockValue').value = '';
    document.getElementById('bourseStockColor').value = '#6c63ff';
    document.getElementById('bourseStockDesc').value = '';
    const hqEl = document.getElementById('bourseStockHQ'); if(hqEl) hqEl.value = '';
    const sel = document.getElementById('bourseStockCharSelect');
    if(sel) sel.value = '';
    document.getElementById('bourse-stock-modal-title').textContent = '📈 Coter une action';
    document.getElementById('bourse-stock-modal').classList.remove('hidden');
    socket.emit('request_all_chars_companies');
}

function openStockEditModal(stockId) {
    const stock = stocksData.find(s => String(s._id) === stockId);
    if(!stock) return;
    currentStockEdit = stock;
    document.getElementById('bourseStockId').value = stockId;
    document.getElementById('bourseStockValue').value = stock.currentValue || '';
    document.getElementById('bourseStockColor').value = stock.stockColor || '#6c63ff';
    document.getElementById('bourseStockDesc').value = stock.description || '';
    const hqEl2 = document.getElementById('bourseStockHQ'); if(hqEl2) hqEl2.value = stock.headquarters || '';
    document.getElementById('bourse-stock-modal-title').textContent = '✏️ Modifier l\'action';
    document.getElementById('bourse-stock-modal').classList.remove('hidden');
    socket.emit('request_all_chars_companies');
}

function closeStockModal() { document.getElementById('bourse-stock-modal').classList.add('hidden'); }

socket.on('all_chars_companies', (data) => {
    const select = document.getElementById('bourseStockCharSelect');
    if(!select) return;
    const prevVal = select.value;
    select.innerHTML = '<option value="">— Choisir une entreprise —</option>';
    data.forEach(c => {
        if(c.companies && c.companies.length > 0) {
            const og = document.createElement('optgroup');
            og.label = `${c.charName}`;
            c.companies.forEach(co => {
                const opt = document.createElement('option');
                opt.value = JSON.stringify({ charId: c.charId, charName: c.charName, charColor: c.charColor, companyName: co.name, companyLogo: co.logo || '' });
                opt.textContent = co.name;
                og.appendChild(opt);
            });
            select.appendChild(og);
        }
    });
    if(prevVal) select.value = prevVal;
});

function submitStockAdmin() {
    const idVal = document.getElementById('bourseStockId').value;
    const selectVal = document.getElementById('bourseStockCharSelect').value;
    const value = parseFloat(document.getElementById('bourseStockValue').value);
    const color = document.getElementById('bourseStockColor').value;
    const desc = document.getElementById('bourseStockDesc').value.trim();
    const hq = document.getElementById('bourseStockHQ')?.value.trim() || null;
    if(!value || isNaN(value)) return alert('Valeur boursière requise.');
    let companyData = {};
    if(selectVal) {
        try { companyData = JSON.parse(selectVal); } catch(e) {}
    } else if(currentStockEdit) {
        companyData = { charId: currentStockEdit.charId, charName: currentStockEdit.charName, charColor: currentStockEdit.charColor, companyName: currentStockEdit.companyName, companyLogo: currentStockEdit.companyLogo };
    }
    if(!companyData.companyName) return alert('Sélectionnez une entreprise.');
    socket.emit('admin_save_stock', { stockId: idVal || null, ...companyData, stockColor: color, currentValue: value, description: desc, headquarters: hq });
    closeStockModal();
}

function adminStockTrend(stockId, trend) {
    socket.emit('admin_apply_stock_trend', { stockId, trend });
}

function adminApplyStockCustomPct() {
    const pct = parseFloat(document.getElementById('bourseCustomPct').value);
    const stockId = document.getElementById('bourseCustomStockId').value;
    if(!stockId) return alert('Sélectionnez une action.');
    if(isNaN(pct) || pct < -100 || pct > 100) return alert('Pourcentage invalide (entre -100 et +100).');
    socket.emit('admin_apply_stock_custom', { stockId, pct });
    document.getElementById('bourseCustomPct').value = '';
}

function adminDeleteStock(stockId) {
    socket.emit('admin_delete_stock', { stockId });
}

function adminResetStockHistory(stockId) {
    if(!IS_ADMIN || !stockId) return;
    socket.emit('admin_reset_stock_history', { stockId });
    showToast('Historique réinitialisé !');
}

function adminNextTradingDay() {
    if(!IS_ADMIN) return;
    socket.emit('admin_next_trading_day');
}
function applyCustomPctCard(stockId) {
    const input = document.getElementById(`cpct-${stockId}`);
    if(!input) return;
    const pct = parseFloat(input.value);
    if(isNaN(pct)) return;
    socket.emit('admin_apply_stock_custom', { stockId, pct });
    input.value = '';
}

function openStockDetail(stockId) {
    const stock = stocksData.find(s => String(s._id) === stockId);
    if(!stock) return;
    const hist = stock.history || [];
    const prev = hist.length >= 2 ? hist[hist.length - 2].value : (hist.length === 1 ? hist[0].value : stock.currentValue);
    const pct = prev ? ((stock.currentValue - prev) / prev * 100) : 0;
    const isUp = pct > 0, isDown = pct < 0;
    const revenue = stock.revenue || 0;
    document.getElementById('stock-detail-content').innerHTML = `
        <div class="stock-detail-hero">
            ${stock.companyLogo ? `<img src="${escapeHtml(stock.companyLogo)}" class="stock-detail-logo" alt="">` : `<div class="stock-detail-logo-placeholder"><i class="fa-solid fa-building"></i></div>`}
            <div>
                <div class="stock-detail-name">${escapeHtml(stock.companyName)}</div>
                <div class="stock-detail-char" style="color:${stock.charColor||'var(--text-muted)'}"><i class="fa-solid fa-user"></i> ${escapeHtml(stock.charName||'')}</div>
                ${stock.headquarters ? `<div class="stock-detail-meta"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(stock.headquarters)}</div>` : ''}
            </div>
        </div>
        <div class="stock-detail-value-row">
            <span class="stock-detail-value" style="color:${isUp?'#23a559':isDown?'#da373c':'white'}">${formatStockValue(stock.currentValue)}</span>
            <span class="stock-badge ${isUp?'badge-up':isDown?'badge-down':'badge-neutral'}">${isUp?'▲':isDown?'▼':'—'} ${Math.abs(pct).toFixed(2)}%</span>
        </div>
        ${revenue > 0 ? `<div class="stock-detail-stat"><i class="fa-solid fa-chart-bar" style="color:var(--accent)"></i> CA : <strong>${formatStockValue(revenue)}</strong></div>` : ''}
        ${stock.description ? `<div class="stock-detail-desc">${escapeHtml(stock.description)}</div>` : ''}
        <div class="stock-detail-chart-wrap" id="stock-detail-chart"></div>
    `;
    renderStockMiniChart(hist.slice(-14), stock.currentValue, 'stock-detail-chart', stock.stockColor || '#6c63ff', pct >= 0);
    const adminEl = document.getElementById('stock-detail-admin');
    if(IS_ADMIN) {
        document.getElementById('stockDetailCharId').value = stock.charId || '';
        document.getElementById('stockDetailCompanyName').value = stock.companyName || '';
        document.getElementById('stockDetailRevenue').value = revenue > 0 ? revenue : '';
        adminEl.classList.remove('hidden');
    } else {
        adminEl.classList.add('hidden');
    }
    currentStockDetailId = stockId;
    document.getElementById('stock-detail-overlay').classList.remove('hidden');
    document.getElementById('stock-detail-panel').classList.add('open');
}

function closeStockDetail() {
    document.getElementById('stock-detail-overlay').classList.add('hidden');
    document.getElementById('stock-detail-panel').classList.remove('open');
}

function adminSetStockRevenue() {
    if(!IS_ADMIN) return;
    const charId = document.getElementById('stockDetailCharId').value;
    const companyName = document.getElementById('stockDetailCompanyName').value;
    const revenue = parseFloat(document.getElementById('stockDetailRevenue').value);
    if(!charId || !companyName || isNaN(revenue)) return;
    socket.emit('admin_set_company_revenue', { charId, companyName, revenue });
    showToast('Chiffre d\'affaires mis à jour !');
}

// ==================== [FIN BOURSE] ====================

// ==================== [TOAST] ====================
function showToast(message, duration = 2500) {
    let toast = document.getElementById('cosmos-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'cosmos-toast';
        toast.className = 'cosmos-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('visible'), duration);
}

// ==================== [WIKI] ====================
let wikiCache = [];
let currentWikiPageId = null;

function loadWiki() {
    socket.emit('request_wiki_pages');
}

socket.on('wiki_pages_data', (pages) => {
    wikiCache = pages;
    renderWikiList(pages);
    updateWikiAdminUI();
});

function updateWikiAdminUI() {
    const header = document.getElementById('wiki-admin-header');
    if(header) { if(IS_ADMIN) header.classList.remove('hidden'); else header.classList.add('hidden'); }
}

function renderWikiList(pages) {
    const container = document.getElementById('wiki-categories-container');
    if(!container) return;

    // On ne réaffiche la liste que si on est sur la vue liste
    if(!document.getElementById('wiki-list-view').classList.contains('hidden')) {
        const categories = { histoire: [], personnages: [], lore: [] };
        pages.forEach(p => {
            const cat = p.category || 'histoire';
            if(!categories[cat]) categories[cat] = [];
            categories[cat].push(p);
        });
        const LABELS = { histoire: '📜 Histoire', personnages: '👤 Personnages', lore: '🌍 Lore' };
        let html = '';
        for(const [cat, items] of Object.entries(categories)) {
            if(!items.length) continue;
            html += `<div class="wiki-category-section">
                <div class="wiki-category-title">${LABELS[cat] || cat}</div>
                <div class="wiki-cards-grid">
                    ${items.map(p => `
                        <div class="wiki-card" onclick="openWikiPage('${p._id}')">
                            ${p.coverImage ? `<img src="${escapeHtml(p.coverImage)}" class="wiki-card-cover" alt="">` : `<div class="wiki-card-cover wiki-card-cover-placeholder"><i class="fa-solid fa-book-open"></i></div>`}
                            <div class="wiki-card-body">
                                <div class="wiki-card-title">${escapeHtml(p.title)}</div>
                                <div class="wiki-card-meta">${escapeHtml(p.authorName || 'Admin')} · ${new Date(p.updatedAt).toLocaleDateString('fr-FR')}</div>
                            </div>
                            ${IS_ADMIN ? `<div class="wiki-card-admin">
                                <button onclick="event.stopPropagation(); openWikiEditModal('${p._id}')" title="Modifier"><i class="fa-solid fa-pen"></i></button>
                                <button onclick="event.stopPropagation(); deleteWikiPage('${p._id}')" title="Supprimer" style="color:#da373c;"><i class="fa-solid fa-trash"></i></button>
                            </div>` : ''}
                        </div>`).join('')}
                </div>
            </div>`;
        }
        if(!html) html = '<div class="wiki-empty"><i class="fa-solid fa-book-open"></i><p>Le Wiki est vide pour l\'instant.</p></div>';
        container.innerHTML = html;
    }
}

function openWikiPage(id) {
    const page = wikiCache.find(p => String(p._id) === String(id));
    if(!page) return;
    currentWikiPageId = id;

    document.getElementById('wiki-list-view').classList.add('hidden');
    document.getElementById('wiki-page-view').classList.remove('hidden');

    const content = document.getElementById('wiki-page-content');
    const coverHTML = page.coverImage
        ? `<img src="${escapeHtml(page.coverImage)}" class="wiki-full-cover" alt="">`
        : '';
    const LABELS = { histoire: '📜 Histoire', personnages: '👤 Personnages', lore: '🌍 Lore' };
    const adminButtons = IS_ADMIN
        ? `<div style="display:flex;gap:8px;margin-bottom:16px;">
               <button class="btn-secondary" onclick="openWikiEditModal('${page._id}')"><i class="fa-solid fa-pen"></i> Modifier</button>
               <button class="btn-secondary" style="color:#da373c;" onclick="deleteWikiPage('${page._id}')"><i class="fa-solid fa-trash"></i> Supprimer</button>
           </div>`
        : '';
    content.innerHTML = `
        ${coverHTML}
        <div class="wiki-page-header">
            <span class="wiki-page-cat">${LABELS[page.category] || page.category}</span>
            <h1 class="wiki-page-title">${escapeHtml(page.title)}</h1>
            <div class="wiki-page-meta">Par ${escapeHtml(page.authorName || 'Admin')} · Mis à jour le ${new Date(page.updatedAt).toLocaleDateString('fr-FR')}</div>
        </div>
        ${adminButtons}
        <div class="wiki-page-body">${renderWikiMarkdown(page.content || '')}</div>`;
}

function closeWikiPage() {
    currentWikiPageId = null;
    document.getElementById('wiki-list-view').classList.remove('hidden');
    document.getElementById('wiki-page-view').classList.add('hidden');
}

function renderWikiMarkdown(text) {
    if(!text) return '';
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^#{3} (.+)$/gm, '<h3>$1</h3>')
        .replace(/^#{2} (.+)$/gm, '<h2>$1</h2>')
        .replace(/^#{1} (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

// --- Admin Wiki ---
function openWikiCreateModal() {
    document.getElementById('wikiPageId').value = '';
    document.getElementById('wikiPageTitle').value = '';
    document.getElementById('wikiPageCategory').value = 'histoire';
    document.getElementById('wikiPageCoverUrl').value = '';
    document.getElementById('wikiPageContent').value = '';
    document.getElementById('wiki-modal-title').innerHTML = '<i class="fa-solid fa-plus"></i> Nouvelle page Wiki';
    document.getElementById('wiki-edit-modal').classList.remove('hidden');
}

function openWikiEditModal(id) {
    const page = wikiCache.find(p => String(p._id) === String(id));
    if(!page) return;
    document.getElementById('wikiPageId').value = page._id;
    document.getElementById('wikiPageTitle').value = page.title || '';
    document.getElementById('wikiPageCategory').value = page.category || 'histoire';
    document.getElementById('wikiPageCoverUrl').value = page.coverImage || '';
    document.getElementById('wikiPageContent').value = page.content || '';
    document.getElementById('wiki-modal-title').innerHTML = '<i class="fa-solid fa-pen"></i> Modifier la page';
    document.getElementById('wiki-edit-modal').classList.remove('hidden');
}

function closeWikiModal() {
    document.getElementById('wiki-edit-modal').classList.add('hidden');
}

async function uploadWikiCover(input) {
    const file = input.files[0];
    if(!file) return;
    const url = await uploadToCloudinary(file);
    if(url) document.getElementById('wikiPageCoverUrl').value = url;
}

function submitWikiPage() {
    const pageId = document.getElementById('wikiPageId').value;
    const title = document.getElementById('wikiPageTitle').value.trim();
    const category = document.getElementById('wikiPageCategory').value;
    const content = document.getElementById('wikiPageContent').value;
    const coverImage = document.getElementById('wikiPageCoverUrl').value.trim() || null;
    if(!title) return alert('Un titre est requis.');
    if(pageId) {
        socket.emit('edit_wiki_page', { pageId, title, category, content, coverImage });
    } else {
        socket.emit('create_wiki_page', { title, category, content, coverImage, authorName: USERNAME });
    }
    closeWikiModal();
}

function deleteWikiPage(id) {
    if(!confirm('Supprimer cette page wiki ?')) return;
    socket.emit('delete_wiki_page', { pageId: id });
    if(currentWikiPageId === id) closeWikiPage();
}
// ==================== [FIN WIKI] ====================
