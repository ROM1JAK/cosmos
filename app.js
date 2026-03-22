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
let currentView = 'chat'; 
let notificationsEnabled = true; 
let currentSelectedChar = null; 
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let allOnlineUsers = []; 

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
    document.querySelectorAll('.view-section').forEach(el => { el.classList.remove('active'); el.classList.add('hidden'); });
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.remove('hidden');
    document.getElementById(`view-${view}`).classList.add('active');
    document.getElementById(`btn-view-${view}`).classList.add('active');
    if(view === 'feed') {
        document.getElementById('btn-view-feed').classList.remove('nav-notify');
        localStorage.setItem('last_feed_visit', Date.now().toString());
        loadFeed();
    }
    if(view === 'presse') { loadPresse(); }
    if(view === 'actualites') { loadActualites(); updateActuAdminForm(); }
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
function toggleCreateForm() { document.getElementById('create-char-form').classList.toggle('hidden'); }
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
    socket.emit('ombra_message', { alias: ombraAlias, content, date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) });
    input.value = '';
}
function appendOmbraMessage(alias, content, date, isSelf) {
    const messages = document.getElementById('ombra-messages');
    const div = document.createElement('div');
    div.className = `ombra-msg ${isSelf ? 'ombra-self' : ''}`;
    div.innerHTML = `<span class="ombra-alias">${alias}</span><span class="ombra-content">${escapeHtml(content)}</span><span class="ombra-time">${date}</span>`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}
function escapeHtml(text) { const d = document.createElement('div'); d.appendChild(document.createTextNode(text)); return d.innerHTML; }

socket.on('ombra_message', (data) => { appendOmbraMessage(data.alias, data.content, data.date, data.alias === ombraAlias); });
socket.on('ombra_history', (history) => {
    const messages = document.getElementById('ombra-messages');
    messages.innerHTML = '';
    history.forEach(m => appendOmbraMessage(m.alias, m.content, m.date, m.alias === ombraAlias));
});

socket.on('login_success', (data) => {
    localStorage.setItem('rp_username', data.username);
    localStorage.setItem('rp_code', data.userId);
    USERNAME = data.username; PLAYER_ID = data.userId; IS_ADMIN = data.isAdmin;
    ombraAlias = data.ombraAlias || null;
    
    if(data.uiTheme) changeTheme(data.uiTheme);
    
    document.getElementById('player-id-display').textContent = `Compte : ${USERNAME}`;
    document.getElementById('btn-account-main').innerHTML = '<i class="fa-solid fa-user"></i> Mon Profil';
    closeLoginModal(); socket.emit('request_initial_data', PLAYER_ID); socket.emit('request_dm_contacts', USERNAME);
    const lastTab = localStorage.getItem('last_tab'); if (lastTab) switchView(lastTab);
    const savedRoom = localStorage.getItem('saved_room_id'); joinRoom(savedRoom || 'global');
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
    allOnlineUsers = users; const listDiv = document.getElementById('online-users-list');
    document.getElementById('online-count').textContent = users.length; listDiv.innerHTML = "";
    users.forEach(u => listDiv.innerHTML += `<div class="online-user" onclick="startDmFromList('${u}')"><span class="status-dot"></span><span>${u}</span></div>`);
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
    
    let avatar = fileInput.files[0] ? await uploadToCloudinary(fileInput.files[0]) : `https://ui-avatars.com/api/?name=${name}&background=random`;
    let partyLogo = partyFileInput.files[0] ? await uploadToCloudinary(partyFileInput.files[0]) : null;
    if(!name || !role) return;
    
    const isOfficial = role.includes('Journaliste') || role.includes('Gouvernement') || role.includes('Presse');
    socket.emit('create_char', { name, role, color: document.getElementById('newCharColor').value, avatar, description: document.getElementById('newCharDesc').value.trim(), ownerId: PLAYER_ID, partyName: partyName || null, partyLogo: partyLogo || null, isOfficial });
    toggleCreateForm(); fileInput.value = ""; partyFileInput.value = ""; document.getElementById('newCharPartyName').value = "";
}
function prepareEditCharacter(id) {
    const char = myCharacters.find(c => c._id === id); if (!char) return;
    document.getElementById('editCharId').value = char._id; document.getElementById('editCharOriginalName').value = char.name; document.getElementById('editCharName').value = char.name;
    document.getElementById('editCharRole').value = char.role; document.getElementById('editCharDesc').value = char.description; document.getElementById('editCharColor').value = char.color;
    document.getElementById('editCharBase64').value = char.avatar; document.getElementById('editCharPartyName').value = char.partyName || ""; document.getElementById('editCharPartyBase64').value = char.partyLogo || "";
    document.getElementById('edit-char-form').classList.remove('hidden'); document.getElementById('create-char-form').classList.add('hidden');
}
function cancelEditCharacter() { document.getElementById('edit-char-form').classList.add('hidden'); }
async function submitEditCharacter() {
    const file = document.getElementById('editCharFile').files[0]; const partyFile = document.getElementById('editCharPartyFile').files[0];
    let newAvatar = document.getElementById('editCharBase64').value; let newPartyLogo = document.getElementById('editCharPartyBase64').value;
    const newPartyName = document.getElementById('editCharPartyName').value.trim();
    if (file) { const url = await uploadToCloudinary(file); if (url) newAvatar = url; }
    if (partyFile) { const url = await uploadToCloudinary(partyFile); if (url) newPartyLogo = url; }
    const newRole = document.getElementById('editCharRole').value.trim();
    const isOfficial = newRole.includes('Journaliste') || newRole.includes('Gouvernement') || newRole.includes('Presse');
    socket.emit('edit_char', { charId: document.getElementById('editCharId').value, originalName: document.getElementById('editCharOriginalName').value, newName: document.getElementById('editCharName').value.trim(), newRole: newRole, newAvatar, newColor: document.getElementById('editCharColor').value, newDescription: document.getElementById('editCharDesc').value.trim(), ownerId: PLAYER_ID, currentRoomId: currentRoomId, partyName: newPartyName || null, partyLogo: newPartyLogo || null, isOfficial });
    cancelEditCharacter(); document.getElementById('editCharFile').value = ""; document.getElementById('editCharPartyFile').value = "";
}
socket.on('my_chars_data', (chars) => { 
    myCharacters = chars; updateUI(); 
    const saved = localStorage.getItem('saved_char_id');
    if (saved && myCharacters.find(c => c._id === saved)) selectCharacter(saved);
    else if (IS_ADMIN && saved === 'narrateur') selectCharacter('narrateur');
});
socket.on('char_created_success', (char) => { myCharacters.push(char); updateUI(); });
function deleteCharacter(id) { if(confirm('Supprimer ?')) socket.emit('delete_char', id); }
socket.on('char_deleted_success', (id) => { myCharacters = myCharacters.filter(c => c._id !== id); updateUI(); });

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
    document.getElementById('profile-overlay').classList.remove('hidden'); 
    document.getElementById('profile-slide-panel').classList.add('open');
    socket.emit('get_char_profile', name); 
}
function closeProfileModal() { 
    document.getElementById('profile-slide-panel').classList.remove('open'); 
    document.getElementById('profile-overlay').classList.add('hidden');
    currentProfileChar = null;
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
    document.getElementById('profileDesc').textContent = char.description || "Aucune description.";
    document.getElementById('profileOwner').textContent = `Joué par : ${char.ownerUsername || "Inconnu"}`;
    if(char.partyName && char.partyLogo) {
        document.getElementById('profileOwner').innerHTML += ` <span class="party-badge" style="display:inline-flex;"><img src="${char.partyLogo}" class="party-logo"> ${char.partyName}</span>`;
    }

    // [NOUVEAU] Bouton modifier bio — visible seulement si c'est un de nos persos
    const btnEditBio = document.getElementById('btn-edit-bio');
    const isOwnChar = myCharacters.some(c => c._id === char._id);
    if(btnEditBio) {
        if(isOwnChar) { btnEditBio.classList.remove('hidden'); }
        else { btnEditBio.classList.add('hidden'); closeBioEdit(); }
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
    document.getElementById('profileDesc').textContent = bio;
    closeBioEdit();
}

// [NOUVEAU] Admin — modale entreprise
function openCompanyModal() {
    if(!currentProfileChar) return;
    const list = document.getElementById('company-existing-list');
    list.innerHTML = '';
    if(currentProfileChar.companies && currentProfileChar.companies.length > 0) {
        currentProfileChar.companies.forEach((co, idx) => {
            list.innerHTML += `<div style="display:flex; align-items:center; gap:8px; padding:8px; background:var(--bg-primary); border-radius:var(--radius-sm); margin-bottom:6px;">
                ${co.logo ? `<img src="${co.logo}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">` : '<i class="fa-solid fa-building" style="color:var(--text-muted);"></i>'}
                <span style="flex:1; font-weight:600;">${co.name}</span>
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
    const logoFile = document.getElementById('companyLogoFile').files[0];
    if(!name) return alert("Nom de l'entreprise requis.");
    let logo = null;
    if(logoFile) logo = await uploadToCloudinary(logoFile);
    socket.emit('admin_add_company', { charId: currentProfileChar._id, company: { name, logo, role, description: desc } });
    document.getElementById('companyName').value = '';
    document.getElementById('companyRole').value = '';
    document.getElementById('companyDesc').value = '';
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

// ==================== DM ENTRE PERSONNAGES ====================
let charDmTarget = null; // { _id, name, avatar, ownerId, ownerUsername }

function openCharDmModal(targetChar) {
    charDmTarget = targetChar;
    document.getElementById('charDmTargetAvatar').src = targetChar.avatar || '';
    document.getElementById('charDmTargetName').textContent = targetChar.name;
    // Remplir sélecteur de perso émetteur
    const sel = document.getElementById('charDmSenderSelect');
    sel.innerHTML = myCharacters.map(c => `<option value="${c._id}">${c.name}</option>`).join('');
    // Charger l'historique pour le premier perso
    loadCharDmHistory();
    document.getElementById('char-dm-modal').classList.remove('hidden');
    // Recharger quand on change de perso émetteur
    sel.onchange = loadCharDmHistory;
}
function closeCharDmModal() { document.getElementById('char-dm-modal').classList.add('hidden'); charDmTarget = null; }

function loadCharDmHistory() {
    if(!charDmTarget) return;
    const sel = document.getElementById('charDmSenderSelect');
    const senderCharId = sel.value;
    socket.emit('request_char_dm_history', { senderCharId, targetCharId: charDmTarget._id });
}

function sendCharDm() {
    if(!charDmTarget || !PLAYER_ID) return;
    const content = document.getElementById('charDmInput').value.trim();
    if(!content) return;
    const sel = document.getElementById('charDmSenderSelect');
    const senderChar = myCharacters.find(c => c._id === sel.value);
    if(!senderChar) return;
    socket.emit('send_char_dm', {
        senderCharId: senderChar._id, senderCharName: senderChar.name,
        senderAvatar: senderChar.avatar, senderColor: senderChar.color, senderRole: senderChar.role,
        senderOwnerUsername: USERNAME,
        targetCharId: charDmTarget._id, targetCharName: charDmTarget.name,
        targetOwnerId: charDmTarget.ownerId, targetOwnerUsername: charDmTarget.ownerUsername,
        ownerId: PLAYER_ID, content,
        date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
    });
    document.getElementById('charDmInput').value = '';
}

socket.on('char_dm_history', ({ msgs }) => {
    const c = document.getElementById('char-dm-messages');
    if(!c) return;
    c.innerHTML = '';
    const sel = document.getElementById('charDmSenderSelect');
    const myCharId = sel ? sel.value : null;
    msgs.forEach(m => appendCharDmMsg(m, myCharId));
    c.scrollTop = c.scrollHeight;
});

socket.on('receive_char_dm', (msg) => {
    const modal = document.getElementById('char-dm-modal');
    if(!modal.classList.contains('hidden') && charDmTarget) {
        const sel = document.getElementById('charDmSenderSelect');
        const myCharId = sel ? sel.value : null;
        const sameConv = (msg.senderCharId === charDmTarget._id || msg.targetCharId === charDmTarget._id);
        if(sameConv) { appendCharDmMsg(msg, myCharId); const c = document.getElementById('char-dm-messages'); c.scrollTop = c.scrollHeight; }
    }
    if(notificationsEnabled && msg.ownerId !== PLAYER_ID) notifSound.play().catch(()=>{});
});

function appendCharDmMsg(msg, myCharId) {
    const c = document.getElementById('char-dm-messages');
    if(!c) return;
    const isSelf = msg.senderCharId === myCharId || msg.ownerId === PLAYER_ID;
    const div = document.createElement('div');
    div.className = `char-dm-msg ${isSelf ? 'char-dm-self' : ''}`;
    div.innerHTML = `
        <img src="${msg.senderAvatar || ''}" class="char-dm-avatar" title="${msg.senderName}">
        <div class="char-dm-bubble">
            <span class="char-dm-sender" style="color:${msg.senderColor||'var(--accent)'};">${msg.senderName}</span>
            <span class="char-dm-text">${formatText(msg.content)}</span>
            <span class="char-dm-time">${msg.date}</span>
        </div>`;
    c.appendChild(div);
}

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

function formatText(text) { if(!text) return ""; return text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\*(.*?)\*/g, '<i>$1</i>').replace(/\|\|(.*?)\|\|/g, '<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>'); }
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
    
    document.getElementById('postContent').value = ""; document.getElementById('postMediaUrl').value = ""; document.getElementById('postMediaFile').value = ""; 
    document.getElementById('postFileStatus').style.display = 'none'; document.getElementById('postAnonymous').checked = false; document.getElementById('postBreakingNews').checked = false;
    document.getElementById('char-count').textContent = `0/1000`; pollOptions = []; document.getElementById('poll-creation-ui').classList.add('hidden'); pollUIOpen = false;
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

socket.on('feed_data', (posts) => { const c = document.getElementById('feed-stream'); c.innerHTML = ""; posts.forEach(p => c.appendChild(createPostElement(p))); });
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
    let html = "";
    comments.forEach(c => {
        const delBtn = IS_ADMIN ? `<span style="color:#da373c; cursor:pointer; margin-left:10px;" onclick="deleteComment('${postId}', '${c.id}')">X</span>` : "";
        let mediaHtml = "";
        if(c.mediaUrl) {
            if(c.mediaType === 'image') mediaHtml = `<img src="${c.mediaUrl}" style="max-width:200px; border-radius:4px; margin-top:5px;">`;
            if(c.mediaType === 'video') mediaHtml = `<video src="${c.mediaUrl}" controls style="max-width:200px; border-radius:4px; margin-top:5px;"></video>`;
            if(c.mediaType === 'audio') mediaHtml = `<audio src="${c.mediaUrl}" controls style="max-width:200px; margin-top:5px;"></audio>`;
        }
        html += `<div class="comment-item"><div class="comment-bubble"><div class="comment-meta"><img src="${c.authorAvatar}" style="width:20px;height:20px;border-radius:50%;margin-right:5px;"><b>${c.authorName}</b> ${c.date}</div><div style="margin-left:25px;">${c.content} ${mediaHtml} ${delBtn}</div></div></div>`;
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
    document.getElementById('presseTitle').value = '';
    document.getElementById('presseContent').value = '';
    document.getElementById('presseMediaUrl').value = '';
    document.getElementById('presseMediaFile').value = '';
    document.getElementById('presseUrgency').value = '';
}

function createArticleElement(post) {
    const div = document.createElement('div');
    div.className = 'article-card';
    if(post.isHeadline) div.classList.add('article-headline');
    if(post.urgencyLevel === 'urgent') div.classList.add('article-breaking');
    div.id = `article-${post._id}`;

    const delBtn = (IS_ADMIN || post.ownerId === PLAYER_ID) ? `<button class="article-del-btn" onclick="event.stopPropagation(); deletePost('${post._id}')"><i class="fa-solid fa-trash"></i></button>` : '';
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
            ${headlineBtn}
            ${urgencyHTML}
            <h2 class="article-title">${escapeHtml(titleText)}</h2>
            <div class="article-byline" onclick="event.stopPropagation(); openProfile('${post.authorName.replace(/'/g, "\\'")}')">
                <img src="${post.authorAvatar}" class="article-author-avatar">
                <div>
                    <span class="article-author-name">${post.authorName}</span>${partyHTML}
                    <span class="article-author-role">${post.authorRole}</span>
                </div>
                <span class="article-date">${post.date}</span>
            </div>
            <div class="article-separator"></div>
            ${articleBodyHTML}
            <!-- [NOUVEAU] Signature rédacteur en pied d'article -->
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
}
function loadActualites() { socket.emit('request_events'); }
function submitEvent() {
    const jour = document.getElementById('actuJour').value.trim();
    const date = document.getElementById('actuDate').value.trim();
    const heure = document.getElementById('actuHeure').value.trim();
    const evenement = document.getElementById('actuEvenement').value.trim();
    if(!evenement) return;
    socket.emit('create_event', { jour, date, heure, evenement });
    document.getElementById('actuJour').value = '';
    document.getElementById('actuDate').value = '';
    document.getElementById('actuHeure').value = '';
    document.getElementById('actuEvenement').value = '';
}
function deleteEvent(id) { if(confirm('Supprimer cet événement ?')) socket.emit('delete_event', id); }

socket.on('events_data', (events) => {
    const c = document.getElementById('events-list'); if(!c) return;
    c.innerHTML = '';
    if(events.length === 0) {
        c.innerHTML = '<div class="actu-empty"><i class="fa-solid fa-calendar-xmark"></i><p>Aucun événement planifié.</p></div>';
        return;
    }
    let lastDate = null;
    events.forEach(ev => {
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
