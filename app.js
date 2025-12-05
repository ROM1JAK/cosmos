

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

// Staging Vars
let pendingAttachment = null; 
let pendingCommentAttachment = null;
let lastMessageData = { author: null, time: 0, ownerId: null }; 

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
    } else {
        formData.append('file', file);
    }
    formData.append('upload_preset', CLOUDINARY_PRESET);
    const uploadUrl = `${CLOUDINARY_BASE_URL}/${resourceType}/upload`;
    try {
        const response = await fetch(uploadUrl, { method: 'POST', body: formData });
        if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
        const data = await response.json();
        return data.secure_url; 
    } catch (error) {
        console.error("Erreur Upload:", error);
        alert("Erreur envoi média : " + error.message);
        return null;
    }
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
}

// --- CLOCK ---
function updateClock() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
    document.getElementById('realtime-clock').textContent = timeString;
}
setInterval(updateClock, 1000);
updateClock();

async function toggleRecording(source) { 
    const btnId = `btn-record-${source}`;
    const btn = document.getElementById(btnId);
    if (!btn) return; 
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.start();
            isRecording = true;
            btn.classList.add('recording');
        } catch (err) { alert("Impossible d'accéder au micro : " + err); }
    } else {
        mediaRecorder.stop();
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            btn.classList.remove('recording');
            isRecording = false;
            if (source === 'chat') { stageAttachment(audioBlob, 'audio'); } 
            else if (source === 'feed') {
                document.getElementById('postFileStatus').style.display = 'block';
                document.getElementById('postFileStatus').innerHTML = 'Envoi audio...';
                const url = await uploadToCloudinary(audioBlob, 'video');
                if (url) {
                    document.getElementById('postMediaUrl').value = url;
                    document.getElementById('postFileStatus').innerHTML = 'Audio prêt <i class="fa-solid fa-check" style="color:#23a559"></i>';
                } else { document.getElementById('postFileStatus').innerHTML = 'Erreur envoi.'; }
            } else if (source === 'comment') { stageCommentMedia({ files: [audioBlob] }, 'audio'); }
        };
    }
}

function handleChatFileSelect(input, type) { if (input.files && input.files[0]) { stageAttachment(input.files[0], type); input.value = ""; } }
function stageAttachment(file, type) {
    pendingAttachment = { file, type };
    const stagingDiv = document.getElementById('chat-staging');
    stagingDiv.classList.remove('hidden');
    let previewHTML = '';
    if (type === 'image') { const url = URL.createObjectURL(file); previewHTML = `<img src="${url}" class="staging-preview">`; } 
    else if (type === 'video') { previewHTML = `<div class="staging-preview" style="background:#000; color:white; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-video"></i></div>`; } 
    else if (type === 'audio') { previewHTML = `<div class="staging-preview" style="background:#222; color:white; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-microphone"></i></div>`; }
    stagingDiv.innerHTML = `${previewHTML}<span class="staging-info">${type === 'audio' ? 'Message Vocal' : file.name}</span><button class="btn-clear-stage" onclick="clearStaging()"><i class="fa-solid fa-xmark"></i></button>`;
}
function clearStaging() { pendingAttachment = null; document.getElementById('chat-staging').classList.add('hidden'); document.getElementById('chat-staging').innerHTML = ""; }

function setupEmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    picker.innerHTML = '';
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
    const input = e.target;
    const cursor = input.selectionStart;
    const textBefore = input.value.substring(0, cursor);
    const lastWord = textBefore.split(/\s/).pop();
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
    notificationsEnabled = !notificationsEnabled;
    const btn = document.getElementById('btn-notif-toggle');
    if(btn) { btn.innerHTML = notificationsEnabled ? '<i class="fa-solid fa-bell"></i> Notifs : ON' : '<i class="fa-solid fa-bell-slash"></i> Notifs : OFF'; btn.style.opacity = notificationsEnabled ? "1" : "0.5"; }
}
function openAccountUI() { if (PLAYER_ID) openUserSettingsModal(); else openLoginModal(); }
function openLoginModal() { document.getElementById('login-modal').classList.remove('hidden'); document.getElementById('login-error-msg').style.display = "none"; }
function closeLoginModal() { document.getElementById('login-modal').classList.add('hidden'); }
function submitLogin() { const pseudo = document.getElementById('loginPseudoInput').value.trim(); const code = document.getElementById('loginCodeInput').value.trim(); if (pseudo && code) socket.emit('login_request', { username: pseudo, code: code }); }
function logoutUser() { if(confirm("Déconnexion ?")) { localStorage.removeItem('rp_username'); localStorage.removeItem('rp_code'); localStorage.removeItem('saved_char_id'); location.reload(); } }
function openUserSettingsModal() { document.getElementById('settingsUsernameInput').value = USERNAME || ""; document.getElementById('settingsCodeInput').value = PLAYER_ID || ""; document.getElementById('settings-msg').textContent = ""; document.getElementById('user-settings-modal').classList.remove('hidden'); }
function closeUserSettingsModal() { document.getElementById('user-settings-modal').classList.add('hidden'); }
function toggleSecretVisibility() { const i = document.getElementById('settingsCodeInput'); i.type = (i.type === "password") ? "text" : "password"; }
function submitUsernameChange() {
    const newName = document.getElementById('settingsUsernameInput').value.trim();
    if (newName && newName !== USERNAME) socket.emit('change_username', { userId: PLAYER_ID, newUsername: newName });
    else document.getElementById('settings-msg').textContent = "Pas de changement.";
}

socket.on('login_success', (data) => {
    localStorage.setItem('rp_username', data.username);
    localStorage.setItem('rp_code', data.userId);
    USERNAME = data.username;
    PLAYER_ID = data.userId;
    IS_ADMIN = data.isAdmin;
    document.getElementById('player-id-display').textContent = `Compte : ${USERNAME}`;
    document.getElementById('btn-account-main').innerHTML = '<i class="fa-solid fa-user"></i> Mon Profil';
    closeLoginModal();
    socket.emit('request_initial_data', PLAYER_ID);
    socket.emit('request_dm_contacts', USERNAME);
    const lastTab = localStorage.getItem('last_tab');
    if (lastTab) switchView(lastTab);
    const savedRoom = localStorage.getItem('saved_room_id');
    joinRoom(savedRoom || 'global');
});
socket.on('login_error', (msg) => { const el = document.getElementById('login-error-msg'); el.textContent = msg; el.style.display = 'block'; });
socket.on('username_change_success', (newName) => { USERNAME = newName; localStorage.setItem('rp_username', newName); document.getElementById('player-id-display').textContent = `Compte : ${USERNAME}`; document.getElementById('settings-msg').textContent = "OK !"; });
socket.on('username_change_error', (msg) => { document.getElementById('settings-msg').textContent = msg; });

function checkAutoLogin() {
    const savedUser = localStorage.getItem('rp_username');
    const savedCode = localStorage.getItem('rp_code');
    if (savedUser && savedCode) socket.emit('login_request', { username: savedUser, code: savedCode });
    else openLoginModal();
}

socket.on('connect', () => { checkAutoLogin(); setupEmojiPicker(); });
socket.on('update_user_list', (users) => {
    allOnlineUsers = users;
    const listDiv = document.getElementById('online-users-list');
    document.getElementById('online-count').textContent = users.length;
    listDiv.innerHTML = "";
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
    currentRoomId = roomId;
    lastMessageData = { author: null, time: 0 }; 
    localStorage.setItem('saved_room_id', roomId);
    currentDmTarget = null; 
    socket.emit('join_room', currentRoomId);
    if (unreadRooms.has(currentRoomId)) unreadRooms.delete(currentRoomId);
    const room = allRooms.find(r => r._id === roomId);
    document.getElementById('currentRoomName').textContent = room ? room.name : 'Salon Global';
    document.getElementById('currentRoomName').style.color = "var(--text-primary)";
    document.getElementById('messages').innerHTML = ""; 
    document.getElementById('typing-indicator').classList.add('hidden');
    document.getElementById('char-selector-wrapper').classList.remove('hidden'); 
    document.getElementById('dm-header-actions').classList.add('hidden');
    socket.emit('request_history', currentRoomId);
    cancelContext(); clearStaging();
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
    document.getElementById('currentRoomName').textContent = `@${target}`;
    document.getElementById('currentRoomName').style.color = "#9b59b6"; 
    document.getElementById('messages').innerHTML = "";
    document.getElementById('char-selector-wrapper').classList.add('hidden'); 
    document.getElementById('dm-header-actions').classList.remove('hidden'); 
    cancelContext(); clearStaging();
    socket.emit('request_dm_history', { myUsername: USERNAME, targetUsername: target });
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
    const fileInput = document.getElementById('newCharFile');
    let avatar = fileInput.files[0] ? await uploadToCloudinary(fileInput.files[0]) : `https://ui-avatars.com/api/?name=${name}&background=random`;
    if(!name || !role) return;
    socket.emit('create_char', { name, role, color: document.getElementById('newCharColor').value, avatar, description: document.getElementById('newCharDesc').value.trim(), ownerId: PLAYER_ID });
    toggleCreateForm(); fileInput.value = ""; 
}
function prepareEditCharacter(id) {
    const char = myCharacters.find(c => c._id === id); if (!char) return;
    document.getElementById('editCharId').value = char._id;
    document.getElementById('editCharOriginalName').value = char.name;
    document.getElementById('editCharName').value = char.name;
    document.getElementById('editCharRole').value = char.role;
    document.getElementById('editCharDesc').value = char.description; 
    document.getElementById('editCharColor').value = char.color;
    document.getElementById('editCharBase64').value = char.avatar; 
    document.getElementById('edit-char-form').classList.remove('hidden'); document.getElementById('create-char-form').classList.add('hidden');
}
function cancelEditCharacter() { document.getElementById('edit-char-form').classList.add('hidden'); }
async function submitEditCharacter() {
    const file = document.getElementById('editCharFile').files[0];
    let newAvatar = document.getElementById('editCharBase64').value; 
    if (file) { const url = await uploadToCloudinary(file); if (url) newAvatar = url; }
    socket.emit('edit_char', { 
        charId: document.getElementById('editCharId').value, 
        originalName: document.getElementById('editCharOriginalName').value, 
        newName: document.getElementById('editCharName').value.trim(), 
        newRole: document.getElementById('editCharRole').value.trim(), 
        newAvatar, 
        newColor: document.getElementById('editCharColor').value, 
        newDescription: document.getElementById('editCharDesc').value.trim(), 
        ownerId: PLAYER_ID, currentRoomId: currentRoomId 
    });
    cancelEditCharacter(); document.getElementById('editCharFile').value = "";
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
    const bar = document.getElementById('char-bar-horizontal');
    const icon = document.getElementById('toggle-icon');
    bar.classList.toggle('hidden-bar');
    if (bar.classList.contains('hidden-bar')) { icon.classList.remove('fa-chevron-down'); icon.classList.add('fa-chevron-up'); } 
    else { icon.classList.remove('fa-chevron-up'); icon.classList.add('fa-chevron-down'); }
}

// UPDATE UI (Includes Feed Selector - New Avatar Bar)
function updateUI() {
    const list = document.getElementById('myCharList');
    const bar = document.getElementById('char-bar-horizontal');
    const feedBar = document.getElementById('feed-char-bar'); // NEW Container
    list.innerHTML = ""; bar.innerHTML = ""; feedBar.innerHTML = "";
    
    // Narrateur Admin
    if(IS_ADMIN) {
        bar.innerHTML += `<img src="https://cdn-icons-png.flaticon.com/512/1144/1144760.png" id="avatar-opt-narrateur" class="avatar-choice" title="Narrateur" onclick="selectCharacter('narrateur')">`;
    }
    
    // Default selection logic for Feed
    if (myCharacters.length > 0 && !currentFeedCharId) currentFeedCharId = myCharacters[0]._id;

    myCharacters.forEach((char) => {
        list.innerHTML += `<div class="char-item"><img src="${char.avatar}" class="mini-avatar"><div class="char-info"><div class="char-name-list" style="color:${char.color}">${char.name}</div><div class="char-role-list">${char.role}</div></div><div class="char-actions"><button class="btn-mini-action" onclick="prepareEditCharacter('${char._id}')"><i class="fa-solid fa-gear"></i></button><button class="btn-mini-action" onclick="deleteCharacter('${char._id}')" style="color:#da373c;"><i class="fa-solid fa-trash"></i></button></div></div>`;
        bar.innerHTML += `<img src="${char.avatar}" id="avatar-opt-${char._id}" class="avatar-choice" title="${char.name}" onclick="selectCharacter('${char._id}')">`;
        
        // Feed Selector Avatars
        const feedAvatar = document.createElement('img');
        feedAvatar.src = char.avatar;
        feedAvatar.className = 'feed-avatar-choice';
        feedAvatar.title = char.name;
        if(currentFeedCharId === char._id) feedAvatar.classList.add('active-feed-char');
        feedAvatar.onclick = () => {
            currentFeedCharId = char._id;
            updateUI(); // Refresh to update active class
        };
        feedBar.appendChild(feedAvatar);
    });

    if (!currentSelectedChar) { if(myCharacters.length > 0) selectCharacter(myCharacters[0]._id); else if(IS_ADMIN) selectCharacter('narrateur'); }
    else selectCharacter(currentSelectedChar._id);
}

// --- PROFILE ---
function openProfile(name) { 
    document.getElementById('profile-overlay').classList.remove('hidden');
    document.getElementById('profile-slide-panel').classList.add('open');
    socket.emit('get_char_profile', name); 
}
function closeProfileModal() { 
    document.getElementById('profile-slide-panel').classList.remove('open');
    document.getElementById('profile-overlay').classList.add('hidden');
}

socket.on('char_profile_data', (char) => {
    document.getElementById('profileName').textContent = char.name;
    document.getElementById('profileRole').textContent = char.role;
    document.getElementById('profileAvatar').src = char.avatar;
    document.getElementById('profileDesc').textContent = char.description || "Aucune description.";
    document.getElementById('profileOwner').textContent = `Joué par : ${char.ownerUsername || "Inconnu"}`;
    document.getElementById('profilePostCount').textContent = char.postCount || 0;
    
    const count = char.followers ? char.followers.length : 0;
    const countEl = document.getElementById('profileFollowersCount');
    countEl.textContent = `${count}`;
    document.getElementById('btn-view-followers').onclick = () => socket.emit('get_followers_list', char._id);

    document.getElementById('btn-dm-profile').onclick = function() { closeProfileModal(); if (char.ownerUsername) openDm(char.ownerUsername); };
    
    const btnSub = document.getElementById('btn-sub-profile');
    if(currentFeedCharId === char._id) {
        btnSub.style.display = 'none';
    } else {
        btnSub.style.display = 'block';
        const isSubbed = char.followers && currentFeedCharId && char.followers.includes(currentFeedCharId);
        updateSubButton(btnSub, isSubbed);
        btnSub.onclick = function() {
            if(!currentFeedCharId) return alert("Sélectionnez un personnage dans le Feed !");
            socket.emit('follow_character', { followerCharId: currentFeedCharId, targetCharId: char._id });
        };
    }
});

socket.on('char_profile_updated', (char) => { 
    if(document.getElementById('profile-slide-panel').classList.contains('open') && document.getElementById('profileName').textContent === char.name) {
        const isSubbed = char.followers && currentFeedCharId && char.followers.includes(currentFeedCharId);
        updateSubButton(document.getElementById('btn-sub-profile'), isSubbed);
        document.getElementById('profileFollowersCount').textContent = `${char.followers.length}`;
    }
});
function updateSubButton(btn, subbed) { 
    btn.innerHTML = subbed ? '<i class="fa-solid fa-check"></i> Abonné' : '<i class="fa-solid fa-rss"></i> S\'abonner'; 
    btn.style.color = subbed ? '#23a559' : 'white'; 
}

// Liste Abonnés Modal
socket.on('followers_list_data', (followers) => {
    const listDiv = document.getElementById('followers-list-container');
    listDiv.innerHTML = "";
    if(followers.length === 0) listDiv.innerHTML = "<div style='padding:10px; color:#aaa;'>Aucun abonné.</div>";
    followers.forEach(f => {
        listDiv.innerHTML += `<div style="display:flex; align-items:center; padding:8px; border-bottom:1px solid #333;">
            <img src="${f.avatar}" style="width:30px; height:30px; border-radius:50%; margin-right:10px;">
            <div><div style="font-weight:bold;">${f.name}</div><div style="font-size:0.8em; color:#aaa;">${f.role}</div></div>
        </div>`;
    });
    document.getElementById('followers-modal').classList.remove('hidden');
});

// --- ACTIONS MSG ---
function setContext(type, data) {
    currentContext = { type, data };
    const bar = document.getElementById('context-bar');
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
    const txt = document.getElementById('txtInput');
    const content = txt.value.trim();
    let finalMediaUrl = null, finalMediaType = null;
    if (pendingAttachment) {
        document.getElementById('chat-staging').innerHTML = 'Envoi...';
        let rType = undefined; if(pendingAttachment.type === 'audio') rType = 'video';
        finalMediaUrl = await uploadToCloudinary(pendingAttachment.file, rType);
        finalMediaType = pendingAttachment.type;
        clearStaging();
        if (!finalMediaUrl) return alert("Echec envoi média.");
    }
    if (!content && !finalMediaUrl) return;
    if (currentDmTarget) {
        socket.emit('send_dm', { sender: USERNAME, target: currentDmTarget, content: content || finalMediaUrl, type: finalMediaType || "text", date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) });
        txt.value = ''; cancelContext(); return;
    }
    if (content === "/clear" && !finalMediaUrl) { if(IS_ADMIN) socket.emit('admin_clear_room', currentRoomId); txt.value = ''; return; }
    if (currentContext && currentContext.type === 'edit') { socket.emit('edit_message', { id: currentContext.data.id, newContent: content }); txt.value = ''; cancelContext(); return; }
    if(!currentSelectedChar) return alert("Perso requis !");
    
    const baseMsg = { senderName: currentSelectedChar.name, senderColor: currentSelectedChar.color || "#fff", senderAvatar: currentSelectedChar.avatar, senderRole: currentSelectedChar.role, ownerId: PLAYER_ID, targetName: "", roomId: currentRoomId, date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), replyTo: (currentContext && currentContext.type === 'reply') ? { id: currentContext.data.id, author: currentContext.data.author, content: currentContext.data.content } : null };
    if (finalMediaUrl) socket.emit('message_rp', { ...baseMsg, content: finalMediaUrl, type: finalMediaType });
    if (content) socket.emit('message_rp', { ...baseMsg, content: content, type: "text" });
    txt.value = ''; cancelContext();
}

socket.on('history_data', (msgs) => { 
    if(currentDmTarget) return; 
    const container = document.getElementById('messages'); container.innerHTML = ""; 
    lastMessageData = { author: null, time: 0 };
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
    const audio = new Audio(src);
    const btn = wrapper.querySelector('.play-btn');
    const fill = wrapper.querySelector('.audio-progress-fill');
    const time = wrapper.querySelector('.audio-time');
    audio.addEventListener('loadedmetadata', () => { time.textContent = `${Math.floor(audio.duration/60)}:${Math.floor(audio.duration%60).toString().padStart(2,'0')}`; });
    audio.addEventListener('timeupdate', () => { fill.style.width = (audio.currentTime/audio.duration)*100 + '%'; time.textContent = `${Math.floor(audio.currentTime/60)}:${Math.floor(audio.currentTime%60).toString().padStart(2,'0')}`; });
    audio.addEventListener('ended', () => { btn.innerHTML = '<i class="fa-solid fa-play"></i>'; fill.style.width = '0%'; });
    btn.addEventListener('click', () => { if(audio.paused) { audio.play(); btn.innerHTML = '<i class="fa-solid fa-pause"></i>'; } else { audio.pause(); btn.innerHTML = '<i class="fa-solid fa-play"></i>'; } });
    return wrapper;
}

function displayMessage(msg, isDm = false) {
    const div = document.createElement('div');
    div.className = 'message-container'; 
    if(isDm) div.classList.add('dm-message'); 
    div.id = `msg-${msg._id}`;
    let senderName, senderAvatar, senderColor, senderRole, canEdit = false, canDelete = false;
    if (isDm) {
        senderName = msg.sender || msg.senderName; 
        senderAvatar = `https://ui-avatars.com/api/?name=${senderName}&background=random&color=fff&size=64`; 
        senderColor = "#dbdee1"; senderRole = "Utilisateur";
    } else {
        senderName = msg.senderName; senderAvatar = msg.senderAvatar; senderColor = msg.senderColor; senderRole = msg.senderRole; canEdit = (msg.ownerId === PLAYER_ID); canDelete = (msg.ownerId === PLAYER_ID) || IS_ADMIN;
    }
    if (!isDm && USERNAME && msg.content && typeof msg.content === 'string' && msg.content.includes(`@${USERNAME}`)) { div.classList.add('mentioned'); }
    const msgTime = new Date(msg.timestamp || Date.now()).getTime();
    const timeDiff = msgTime - lastMessageData.time;
    const isGroup = (!isDm && !msg.replyTo && senderName === lastMessageData.author && timeDiff < 120000 && msg.type !== 'image' && msg.type !== 'video'); 
    if (isGroup) {
        div.classList.add('msg-group-followup');
        const stamp = document.createElement('span'); stamp.className = 'group-timestamp'; stamp.innerText = msg.date.substring(0, 5); div.appendChild(stamp);
    } else { lastMessageData = { author: senderName, time: msgTime }; }
    let actionsHTML = "";
    if (!isDm) {
         actionsHTML += `<div class="msg-actions"><button class="action-btn" onclick="triggerReply('${msg._id}', '${senderName.replace(/'/g, "\\'")}', '${(msg.type==='text'?msg.content:'Média').replace(/'/g, "\\'")}')" title="Répondre"><i class="fa-solid fa-reply"></i></button>`;
         if (msg.type === 'text' && canEdit) actionsHTML += `<button class="action-btn" onclick="triggerEdit('${msg._id}', '${msg.content.replace(/'/g, "\\'")}')" title="Modifier"><i class="fa-solid fa-pen"></i></button>`;
         if (canDelete) actionsHTML += `<button class="action-btn" onclick="triggerDelete('${msg._id}')"><i class="fa-solid fa-trash"></i></button>`;
         actionsHTML += `</div>`;
    }
    let contentHTML = "";
    if (msg.type === "image") contentHTML = `<img src="${msg.content}" class="chat-image" onclick="window.open(this.src)">`;
    else if (msg.type === "video") {
        const ytId = getYoutubeId(msg.content);
        if (ytId) contentHTML = `<iframe class="video-frame" src="https://www.youtube.com/embed/${ytId}" allowfullscreen></iframe>`;
        else contentHTML = `<video class="video-direct" controls><source src="${msg.content}"></video>`;
    } 
    else if (msg.type === "audio") { contentHTML = `<div id="audio-placeholder-${msg._id}"></div>`; }
    else contentHTML = `<div class="text-body" id="content-${msg._id}">${formatText(msg.content)}</div>`;
    const editedTag = (msg.edited && msg.type === 'text') ? '<span class="timestamp" style="font-size:0.65rem">(modifié)</span>' : '';
    const avatarClick = isDm ? "" : `onclick="openProfile('${senderName.replace(/'/g, "\\'")}')"`;
    let replyHTML = "";
    if (msg.replyTo && msg.replyTo.author) { replyHTML = `<div class="reply-context-line"><div class="reply-spine"></div><span style="font-weight:600; cursor:pointer;">@${msg.replyTo.author}</span> <span style="font-style:italic; opacity:0.8;">${msg.replyTo.content}</span></div>`; }
    let innerHTML = "";
    if(replyHTML) innerHTML += replyHTML;
    innerHTML += `<div style="display:flex; width:100%;">`;
    innerHTML += `<div class="msg-col-avatar">`;
    if(!isGroup) { innerHTML += `<img src="${senderAvatar}" class="avatar-img" ${avatarClick}>`; }
    innerHTML += `</div><div class="msg-col-content">`;
    if(!isGroup) { innerHTML += `<div class="msg-header"><span class="char-name" style="color:${senderColor}" ${avatarClick}>${senderName}</span>${senderRole ? `<span class="char-role">${senderRole}</span>` : ''}<span class="timestamp">${msg.date}</span></div>`; }
    innerHTML += contentHTML + editedTag;
    innerHTML += `</div>${actionsHTML}</div>`;
    div.innerHTML = innerHTML;
    document.getElementById('messages').appendChild(div);
    if (msg.type === 'audio') { const placeholder = document.getElementById(`audio-placeholder-${msg._id}`); if(placeholder) placeholder.replaceWith(createCustomAudioPlayer(msg.content)); }
}

function scrollToBottom() { const d = document.getElementById('messages'); d.scrollTop = d.scrollHeight; }
document.getElementById('txtInput').addEventListener('keyup', (e) => { if(e.key === 'Enter') sendMessage(); });

// --- FEED LOGIC (UPDATED WITH FEED CHAR ID) ---
function loadFeed() { socket.emit('request_feed'); }
document.getElementById('postContent').addEventListener('input', (e) => { document.getElementById('char-count').textContent = `${e.target.value.length}/1000`; });
async function previewPostFile() {
    const file = document.getElementById('postMediaFile').files[0];
    if(file) {
        document.getElementById('postFileStatus').style.display = 'block';
        document.getElementById('postFileStatus').textContent = "Upload...";
        const url = await uploadToCloudinary(file);
        if(url) { document.getElementById('postMediaUrl').value = url; document.getElementById('postFileStatus').textContent = "Prêt !"; }
    }
}
function submitPost() {
    const content = document.getElementById('postContent').value.trim();
    const mediaUrl = document.getElementById('postMediaUrl').value.trim();
    if(!content && !mediaUrl) return alert("Contenu vide.");
    
    // Use Active Feed Char
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
    
    socket.emit('create_post', { 
        authorCharId: char._id,
        authorName: char.name, 
        authorAvatar: char.avatar, 
        authorRole: char.role, 
        content, mediaUrl, mediaType, 
        date: new Date().toLocaleDateString(), 
        ownerId: PLAYER_ID 
    });
    
    document.getElementById('postContent').value = ""; document.getElementById('postMediaUrl').value = ""; document.getElementById('postMediaFile').value = ""; document.getElementById('postFileStatus').style.display = 'none';
}

function toggleLike(id) { 
    if(!PLAYER_ID) return; 
    if(!currentFeedCharId) return alert("Sélectionnez un perso (Feed).");
    socket.emit('like_post', { postId: id, charId: currentFeedCharId }); 
}
function toggleCommentLike(postId, commentId) {
    if(!PLAYER_ID) return; 
    if(!currentFeedCharId) return alert("Sélectionnez un perso (Feed).");
    socket.emit('like_comment', { postId: postId, commentId: commentId, charId: currentFeedCharId });
}

function deletePost(id) { if(confirm("Supprimer ?")) socket.emit('delete_post', id); }
function reportPost(id) { 
    if(confirm("Signaler ce post à la modération ?")) {
        socket.emit('report_post', id); 
        alert("Signalement envoyé.");
    }
}

let currentDetailPostId = null;
function openPostDetail(id) {
    const postEl = document.getElementById(`post-${id}`); if(!postEl) return;
    currentDetailPostId = id;
    const clone = postEl.cloneNode(true); clone.onclick = null; clone.style.border="none"; clone.classList.remove('highlight-new');
    // Remove comment section from clone to avoid duplication in grid
    const old = clone.querySelector('.comments-list'); if(old) old.remove();
    const oldActions = clone.querySelector('.post-actions'); if(oldActions) oldActions.remove(); // We can keep actions or move them
    
    document.getElementById('post-detail-content').innerHTML = ""; document.getElementById('post-detail-content').appendChild(clone);
    document.getElementById('post-detail-comments-list').innerHTML = postEl.querySelector('.comments-list')?.innerHTML || "";
    document.getElementById('post-detail-modal').classList.remove('hidden');
    clearCommentStaging();
    document.getElementById('btn-detail-comment').onclick = async () => {
        const txt = document.getElementById('post-detail-comment-input').value.trim();
        let mediaUrl = null, mediaType = null;
        if(pendingCommentAttachment && pendingCommentAttachment.files[0]) {
             let rType = (pendingCommentAttachment.type === 'audio') ? 'video' : undefined;
             mediaUrl = await uploadToCloudinary(pendingCommentAttachment.files[0], rType);
             mediaType = pendingCommentAttachment.type;
        }
        if(!txt && !mediaUrl) return;
        
        // Use Active Feed Char
        if(!currentFeedCharId) return alert("Sélectionnez un perso (Feed).");
        const char = myCharacters.find(c => c._id === currentFeedCharId);
        
        socket.emit('post_comment', { 
            postId: id, 
            comment: { 
                authorCharId: char._id,
                authorName: char.name, 
                authorAvatar: char.avatar, 
                content: txt, mediaUrl, mediaType, 
                date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), 
                ownerId: PLAYER_ID 
            } 
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

function replyToComment(authorName) {
    const input = document.getElementById('post-detail-comment-input');
    input.value = `@${authorName} ` + input.value;
    input.focus();
}

socket.on('feed_data', (posts) => { const c = document.getElementById('feed-stream'); c.innerHTML = ""; posts.forEach(p => c.appendChild(createPostElement(p))); });
socket.on('new_post', (post) => { 
    if(currentView !== 'feed') document.getElementById('btn-view-feed').classList.add('nav-notify'); 
    document.getElementById('feed-stream').prepend(createPostElement(post)); 
});
socket.on('post_updated', (post) => {
    const el = document.getElementById(`post-${post._id}`); if(el) el.replaceWith(createPostElement(post));
    if(currentDetailPostId === post._id) {
        document.getElementById('post-detail-comments-list').innerHTML = generateCommentsHTML(post.comments, post._id);
        const likeBtn = document.querySelector('#post-detail-content .action-item.liked-btn'); 
        // Update post like button in modal if needed, or simply let the user re-open if interaction is complex
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
        
        const likesCount = c.likes ? c.likes.length : 0;
        const isLiked = c.likes && currentFeedCharId && c.likes.includes(currentFeedCharId);
        
        html += `<div class="comment-item">
            <div class="comment-bubble">
                <div class="comment-meta"><img src="${c.authorAvatar}" style="width:20px;height:20px;border-radius:50%;margin-right:5px;"><b>${c.authorName}</b> ${c.date}</div>
                <div style="margin-left:25px;">${c.content} ${mediaHtml} ${delBtn}</div>
                <div class="comment-actions-bar">
                    <button class="btn-comment-action" onclick="replyToComment('${c.authorName}')"><i class="fa-solid fa-reply"></i></button>
                    <button class="btn-comment-action ${isLiked?'liked':''}" onclick="toggleCommentLike('${postId}', '${c.id}')"><i class="fa-solid fa-heart"></i> ${likesCount}</button>
                </div>
            </div>
        </div>`;
    });
    return html;
}

function createPostElement(post) {
    const div = document.createElement('div'); div.className = 'post-card'; div.id = `post-${post._id}`;
    const lastVisit = parseInt(localStorage.getItem('last_feed_visit') || '0');
    if (new Date(post.timestamp).getTime() > lastVisit && currentView === 'feed') div.classList.add('post-highlight');
    
    // Check if Active Feed Char liked this
    const isLiked = post.likes.includes(currentFeedCharId); 
    
    const delBtn = (IS_ADMIN || post.ownerId === PLAYER_ID) ? `<button class="action-item" style="position:absolute; top:16px; right:16px; color:#da373c;" onclick="event.stopPropagation(); deletePost('${post._id}')"><i class="fa-solid fa-trash"></i></button>` : '';
    const reportBtn = (!IS_ADMIN && post.ownerId !== PLAYER_ID) ? `<button class="action-item" style="position:absolute; top:16px; right:16px; color:#666;" onclick="event.stopPropagation(); reportPost('${post._id}')" title="Signaler"><i class="fa-solid fa-flag"></i></button>` : '';

    let mediaHTML = "";
    if(post.mediaUrl) {
        if(post.mediaType === 'video' || post.mediaUrl.includes('/video/upload')) {
             const ytId = getYoutubeId(post.mediaUrl);
             if(ytId) mediaHTML = `<iframe class="post-media" src="https://www.youtube.com/embed/${ytId}" frameborder="0" allowfullscreen></iframe>`;
             else mediaHTML = `<video class="post-media" controls src="${post.mediaUrl}"></video>`;
        } else if (post.mediaType === 'audio') { mediaHTML = `<audio controls src="${post.mediaUrl}" style="width:100%; margin-top:10px;"></audio>`; } 
        else { mediaHTML = `<img src="${post.mediaUrl}" class="post-media">`; }
    }
    div.innerHTML = `${delBtn} ${reportBtn}
        <div class="post-header" onclick="event.stopPropagation(); openProfile('${post.authorName.replace(/'/g, "\\'")}')">
            <img src="${post.authorAvatar}" class="post-avatar">
            <div class="post-meta">
                <div class="post-author">${post.authorName}</div>
                <div class="post-role">${post.authorRole}</div>
            </div>
            <span class="post-date">${post.date}</span>
        </div>
        <div class="post-content" onclick="openPostDetail('${post._id}')">${formatText(post.content)}</div>
        ${mediaHTML}
        <div class="post-actions">
            <button class="action-item ${isLiked?'liked':''} liked-btn" onclick="event.stopPropagation(); toggleLike('${post._id}')"><i class="fa-solid fa-heart"></i> ${post.likes.length}</button>
            <button class="action-item" onclick="event.stopPropagation(); openPostDetail('${post._id}')"><i class="fa-solid fa-comment"></i> ${post.comments.length}</button>
        </div>
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
