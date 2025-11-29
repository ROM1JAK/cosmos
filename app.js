var socket = io();
const notifSound = new Audio('https://cdn.discordapp.com/attachments/1323488087288053821/1443747694408503446/notif.mp3?ex=692adb11&is=69298991&hm=8e0c05da67995a54740ace96a2e4630c367db762c538c2dffc11410e79678ed5&'); 

// --- CONFIGURATION CLOUDINARY ---
const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/dllr3ugxz/upload'; // Remplace A_REMPLIR par ton Cloud Name
const CLOUDINARY_PRESET = 'Cosmos'; // Remplace A_REMPLIR par ton Upload Preset (unsigned)

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
let lastFeedVisit = 0; 
let notificationsEnabled = true; 
let currentSelectedChar = null; 

// --- FONCTION D'UPLOAD ---
async function uploadToCloudinary(file) {
    if (!file) return null;
    
    // Vérification basique
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        alert("Fichier non supporté (Image ou Vidéo uniquement).");
        return null;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_PRESET);

    try {
        const response = await fetch(CLOUDINARY_URL, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Erreur upload Cloudinary');

        const data = await response.json();
        return data.secure_url; // L'URL publique du fichier
    } catch (error) {
        console.error("Erreur Upload:", error);
        alert("Erreur lors de l'envoi de l'image. Vérifiez votre config Cloudinary.");
        return null;
    }
}

// --- NAVIGATION ---
function switchView(view) {
    currentView = view;
    document.querySelectorAll('.view-section').forEach(el => {
        el.classList.remove('active');
        el.classList.add('hidden');
    });
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

    document.getElementById(`view-${view}`).classList.remove('hidden');
    document.getElementById(`view-${view}`).classList.add('active');
    document.getElementById(`btn-view-${view}`).classList.add('active');

    if(view === 'feed') {
        document.getElementById('feed-notif-dot').classList.add('hidden');
        lastFeedVisit = Date.now();
        loadFeed();
    }
}

// --- UI & LOGIN / COMPTE ---
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('mobile-overlay').classList.toggle('open'); }
function toggleCreateForm() { document.getElementById('create-char-form').classList.toggle('hidden'); }

function toggleNotifications() {
    notificationsEnabled = !notificationsEnabled;
    const btn = document.getElementById('btn-notif-toggle');
    if(btn) {
        const icon = notificationsEnabled ? '<i class="fa-solid fa-bell"></i>' : '<i class="fa-solid fa-bell-slash"></i>';
        const text = notificationsEnabled ? "Notifications : ON" : "Notifications : OFF";
        btn.innerHTML = `${icon} ${text}`;
        btn.style.opacity = notificationsEnabled ? "1" : "0.5";
    }
}

function openAccountUI() {
    if (PLAYER_ID) openUserSettingsModal();
    else openLoginModal();
}

function openLoginModal() { document.getElementById('login-modal').classList.remove('hidden'); document.getElementById('login-error-msg').style.display = "none"; }
function closeLoginModal() { document.getElementById('login-modal').classList.add('hidden'); }

function submitLogin() {
    const pseudo = document.getElementById('loginPseudoInput').value.trim();
    const code = document.getElementById('loginCodeInput').value.trim();
    if (pseudo && code) socket.emit('login_request', { username: pseudo, code: code });
}

function logoutUser() {
    if(confirm("Déconnexion ?")) {
        localStorage.removeItem('rp_username');
        localStorage.removeItem('rp_code');
        location.reload();
    }
}

function openUserSettingsModal() {
    document.getElementById('settingsUsernameInput').value = USERNAME || "";
    document.getElementById('settingsCodeInput').value = PLAYER_ID || ""; 
    document.getElementById('settings-msg').textContent = "";
    document.getElementById('user-settings-modal').classList.remove('hidden');
}
function closeUserSettingsModal() { document.getElementById('user-settings-modal').classList.add('hidden'); }
function toggleSecretVisibility() {
    const input = document.getElementById('settingsCodeInput');
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    const btn = document.querySelector('.btn-eye');
    btn.innerHTML = isPassword ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
}

function submitUsernameChange() {
    const newName = document.getElementById('settingsUsernameInput').value.trim();
    if (newName && newName !== USERNAME) {
        socket.emit('change_username', { userId: PLAYER_ID, newUsername: newName });
    } else {
        document.getElementById('settings-msg').textContent = "Pas de changement.";
        document.getElementById('settings-msg').style.color = "#eab308";
    }
}

socket.on('login_success', (data) => {
    localStorage.setItem('rp_username', data.username);
    localStorage.setItem('rp_code', data.userId);
    USERNAME = data.username;
    PLAYER_ID = data.userId;
    IS_ADMIN = data.isAdmin;
    document.getElementById('player-id-display').textContent = `Compte : ${USERNAME}`;
    document.getElementById('player-id-display').style.color = IS_ADMIN ? "#da373c" : "var(--accent)";
    document.getElementById('btn-account-main').innerHTML = '<i class="fa-solid fa-user"></i> Mon Profil';
    document.getElementById('btn-account-main').style.background = "#2b2d31"; 
    closeLoginModal();
    socket.emit('request_initial_data', PLAYER_ID);
    socket.emit('request_dm_contacts', USERNAME);
    joinRoom('global');
});

socket.on('login_error', (msg) => { const el = document.getElementById('login-error-msg'); el.textContent = msg; el.style.display = 'block'; });
socket.on('username_change_success', (newName) => {
    USERNAME = newName;
    localStorage.setItem('rp_username', newName);
    document.getElementById('player-id-display').textContent = `Compte : ${USERNAME}`;
    const msgEl = document.getElementById('settings-msg');
    msgEl.textContent = "Pseudo mis à jour !"; msgEl.style.color = "#23a559";
});
socket.on('username_change_error', (msg) => { const msgEl = document.getElementById('settings-msg'); msgEl.textContent = msg; msgEl.style.color = "#da373c"; });

function checkAutoLogin() {
    const savedUser = localStorage.getItem('rp_username');
    const savedCode = localStorage.getItem('rp_code');
    if (savedUser && savedCode) socket.emit('login_request', { username: savedUser, code: savedCode });
    else openLoginModal();
}

socket.on('connect', () => { checkAutoLogin(); });

// Mise à jour temps réel liste utilisateurs
socket.on('update_user_list', (users) => {
    const listDiv = document.getElementById('online-users-list');
    document.getElementById('online-count').textContent = users.length;
    listDiv.innerHTML = "";
    users.forEach(u => {
        listDiv.innerHTML += `<div class="online-user" onclick="startDmFromList('${u}')"><span class="status-dot"></span><span>${u}</span></div>`
    });
});

socket.on('force_history_refresh', (data) => { if (currentRoomId === data.roomId && !currentDmTarget) socket.emit('request_history', currentRoomId); });

// --- GESTION MEDIAS (CLOUD) ---

// On surcharge la prévisualisation pour qu'elle ne fasse rien de lourd (optionnel)
function previewFile(type) {
    // On pourrait afficher une petite preview locale ici mais pour l'instant on laisse le champ file gérer
    const fileInput = document.getElementById(type === 'new' ? 'newCharFile' : 'editCharFile');
    // On ne stocke plus en base64 dans le hidden input
}

// Fonction modifiée pour gérer l'upload chat
function openUrlModal() {
    // Au lieu d'ouvrir la modale URL, on crée un input file temporaire
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = await uploadToCloudinary(file);
            if (url) sendMediaMessage(url, 'image');
        }
    };
    input.click();
}

// Fonction conservée mais non utilisée par le bouton principal (pour compatibilité)
function closeUrlModal() { document.getElementById('url-modal').classList.add('hidden'); }
function submitImageUrl() {
    const url = document.getElementById('urlInput').value.trim();
    if(url) { sendMediaMessage(url, 'image'); document.getElementById('urlInput').value = ""; closeUrlModal(); }
}

function openVideoModal() { document.getElementById('video-modal').classList.remove('hidden'); }
function closeVideoModal() { document.getElementById('video-modal').classList.add('hidden'); }
function submitVideoUrl() {
    const url = document.getElementById('videoInput').value.trim();
    if(url) { sendMediaMessage(url, 'video'); document.getElementById('videoInput').value = ""; closeVideoModal(); }
}

function sendMediaMessage(content, type) {
    if (currentDmTarget) {
         socket.emit('send_dm', { sender: USERNAME, target: currentDmTarget, content: content, type: type, date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) });
        return;
    }
    if(!currentSelectedChar) return alert("Sélectionnez un personnage d'abord !");
    
    socket.emit('message_rp', { 
        content: content, type: type, 
        senderName: currentSelectedChar.name, 
        senderColor: currentSelectedChar.color, 
        senderAvatar: currentSelectedChar.avatar, 
        senderRole: currentSelectedChar.role, 
        ownerId: PLAYER_ID, targetName: "", roomId: currentRoomId, 
        date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), replyTo: null 
    });
}

// --- TYPING ---
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

// --- ROOMS ---
function createRoomPrompt() { const name = prompt("Nom du salon :"); if (name) socket.emit('create_room', { name, creatorId: PLAYER_ID, allowedCharacters: [] }); }
function deleteRoom(roomId) { if(confirm("ADMIN : Supprimer ?")) socket.emit('delete_room', roomId); }

function joinRoom(roomId) {
    if (currentRoomId && currentRoomId !== roomId) socket.emit('leave_room', currentRoomId);
    currentRoomId = roomId;
    currentDmTarget = null; 
    socket.emit('join_room', currentRoomId);
    if (unreadRooms.has(currentRoomId)) unreadRooms.delete(currentRoomId);

    const room = allRooms.find(r => r._id === roomId);
    document.getElementById('currentRoomName').textContent = room ? room.name : 'Salon Global';
    document.getElementById('currentRoomName').style.color = "white";
    document.getElementById('messages').innerHTML = ""; 
    document.getElementById('typing-indicator').classList.add('hidden');
    document.getElementById('char-bar').classList.remove('hidden'); 
    document.getElementById('dm-header-actions').classList.add('hidden');

    socket.emit('request_history', currentRoomId);
    cancelContext();
    if(window.innerWidth <= 768) { document.getElementById('sidebar').classList.remove('open'); document.getElementById('mobile-overlay').classList.remove('open'); }
    updateRoomListUI();
    updateDmListUI();
    switchView('chat'); 
}
socket.on('rooms_data', (rooms) => { allRooms = rooms; updateRoomListUI(); });

function updateRoomListUI() {
    const list = document.getElementById('roomList');
    list.innerHTML = `<div class="room-item ${(currentRoomId === 'global' && !currentDmTarget)?'active':''} ${unreadRooms.has('global')?'unread':''}" onclick="joinRoom('global')"><span class="room-name">Salon Global</span></div>`;
    allRooms.forEach(room => {
        const delBtn = IS_ADMIN ? `<button class="btn-del-room" onclick="event.stopPropagation(); deleteRoom('${room._id}')"><i class="fa-solid fa-trash"></i></button>` : '';
        const isUnread = unreadRooms.has(room._id) ? 'unread' : '';
        const isActive = (String(currentRoomId) === String(room._id) && !currentDmTarget) ? 'active' : '';
        list.innerHTML += `<div class="room-item ${isActive} ${isUnread}" onclick="joinRoom('${room._id}')"><span class="room-name">${room.name}</span>${delBtn}</div>`;
    });
}

// --- DM / MP AVANCÉ ---
function startDmFromList(targetUsername) {
    if (targetUsername === USERNAME) return alert("C'est vous !");
    openDm(targetUsername);
}
socket.on('open_dm_ui', (targetUsername) => { openDm(targetUsername); });

function openDm(targetUsername) {
    currentDmTarget = targetUsername;
    currentRoomId = null; 
    if (!dmContacts.includes(targetUsername)) dmContacts.push(targetUsername);
    if (unreadDms.has(targetUsername)) unreadDms.delete(targetUsername);

    document.getElementById('currentRoomName').textContent = `@${targetUsername}`;
    document.getElementById('currentRoomName').style.color = "#7d5bc4"; 
    document.getElementById('messages').innerHTML = "";
    document.getElementById('typing-indicator').classList.add('hidden');
    document.getElementById('char-bar').classList.add('hidden'); 
    document.getElementById('dm-header-actions').classList.remove('hidden'); 
    
    cancelContext();
    socket.emit('request_dm_history', { myUsername: USERNAME, targetUsername: targetUsername });
    updateRoomListUI(); 
    updateDmListUI();
    switchView('chat'); 
    if(window.innerWidth <= 768) { document.getElementById('sidebar').classList.remove('open'); document.getElementById('mobile-overlay').classList.remove('open'); }
}

function closeCurrentDm() {
    if(!currentDmTarget) return;
    dmContacts = dmContacts.filter(c => c !== currentDmTarget);
    joinRoom('global');
}

function deleteCurrentDmHistory() {
    if(!currentDmTarget) return;
    if(confirm(`Supprimer TOUT l'historique avec ${currentDmTarget} ? (Irréversible pour les deux)`)) {
        socket.emit('delete_dm_history', { myUsername: USERNAME, targetUsername: currentDmTarget });
    }
}
socket.on('dm_history_deleted', (target) => {
    if(currentDmTarget === target) document.getElementById('messages').innerHTML = "<div style='text-align:center; color:#da373c; margin-top:20px;'><i>Historique supprimé.</i></div>";
});

socket.on('dm_contacts_data', (contacts) => { dmContacts = contacts; updateDmListUI(); });
function updateDmListUI() {
    const list = document.getElementById('dmList');
    list.innerHTML = "";
    dmContacts.forEach(contact => {
        const isActive = (currentDmTarget === contact) ? 'active' : '';
        const isUnread = unreadDms.has(contact) ? 'unread' : '';
        const avatarUrl = `https://ui-avatars.com/api/?name=${contact}&background=random&color=fff&size=64`;
        list.innerHTML += `<div class="dm-item ${isActive} ${isUnread}" onclick="openDm('${contact}')"><img src="${avatarUrl}" class="dm-avatar"><span>${contact}</span></div>`;
    });
}
socket.on('dm_history_data', (data) => {
    if (currentDmTarget !== data.target) return; 
    const container = document.getElementById('messages');
    container.innerHTML = "";
    data.history.forEach(msg => { displayMessage(msg, true); });
    scrollToBottom();
});
socket.on('receive_dm', (msg) => {
    const otherUser = (msg.sender === USERNAME) ? msg.target : msg.sender;
    if (!dmContacts.includes(otherUser)) { dmContacts.push(otherUser); updateDmListUI(); }
    if (currentDmTarget === otherUser) { displayMessage(msg, true); scrollToBottom(); } 
    else { unreadDms.add(otherUser); updateDmListUI(); }
    if (msg.sender !== USERNAME && notificationsEnabled) notifSound.play().catch(e=>{});
});

// --- CHARACTERS (MODIFIÉ POUR CLOUDINARY) ---
async function createCharacter() {
    const name = document.getElementById('newCharName').value.trim();
    const role = document.getElementById('newCharRole').value.trim();
    const desc = document.getElementById('newCharDesc').value.trim();
    const color = document.getElementById('newCharColor').value;
    
    // Upload File
    const fileInput = document.getElementById('newCharFile');
    const file = fileInput.files[0];
    let avatar = null;

    if (file) {
        avatar = await uploadToCloudinary(file);
        if (!avatar) return; // Erreur upload
    } else {
        avatar = `https://ui-avatars.com/api/?name=${name}&background=random`;
    }

    if(!name || !role) return alert("Nom et Rôle requis");
    socket.emit('create_char', { name, role, color, avatar, description: desc, ownerId: PLAYER_ID });
    toggleCreateForm();
    fileInput.value = ""; // Reset input
}

function prepareEditCharacter(charId) {
    const char = myCharacters.find(c => c._id === charId);
    if (!char) return;
    document.getElementById('editCharId').value = char._id;
    document.getElementById('editCharOriginalName').value = char.name;
    document.getElementById('editCharName').value = char.name;
    document.getElementById('editCharRole').value = char.role;
    document.getElementById('editCharDesc').value = char.description; 
    document.getElementById('editCharColor').value = char.color;
    document.getElementById('editCharBase64').value = char.avatar; // On garde l'ancien URL en backup
    document.getElementById('edit-char-form').classList.remove('hidden');
    document.getElementById('create-char-form').classList.add('hidden');
}

function cancelEditCharacter() { document.getElementById('edit-char-form').classList.add('hidden'); }

async function submitEditCharacter() {
    const charId = document.getElementById('editCharId').value;
    const originalName = document.getElementById('editCharOriginalName').value;
    const newName = document.getElementById('editCharName').value.trim();
    const newRole = document.getElementById('editCharRole').value.trim();
    const newColor = document.getElementById('editCharColor').value;
    const newDesc = document.getElementById('editCharDesc').value.trim();
    
    // Upload nouveau fichier si présent
    const fileInput = document.getElementById('editCharFile');
    const file = fileInput.files[0];
    let newAvatar = document.getElementById('editCharBase64').value; // Par défaut l'ancien

    if (file) {
        const uploadedUrl = await uploadToCloudinary(file);
        if (uploadedUrl) newAvatar = uploadedUrl;
    }

    socket.emit('edit_char', { charId, originalName, newName, newRole, newAvatar, newColor, newDescription: newDesc, ownerId: PLAYER_ID, currentRoomId: currentRoomId });
    cancelEditCharacter();
    fileInput.value = "";
}

socket.on('my_chars_data', (chars) => { myCharacters = chars; updateUI(); });
socket.on('char_created_success', (char) => { myCharacters.push(char); updateUI(); });
function deleteCharacter(id) { if(confirm('Supprimer ?')) socket.emit('delete_char', id); }
socket.on('char_deleted_success', (id) => { myCharacters = myCharacters.filter(c => c._id !== id); updateUI(); });

function selectCharacter(charId) {
    const narrateur = { _id: 'narrateur', name: 'Narrateur', role: 'Omniscient', color: '#ffffff', avatar: 'https://cdn-icons-png.flaticon.com/512/1144/1144760.png' };
    
    if (charId === 'narrateur') currentSelectedChar = narrateur;
    else currentSelectedChar = myCharacters.find(c => c._id === charId);

    document.querySelectorAll('.char-avatar-option').forEach(el => el.classList.remove('selected'));
    const selectedEl = document.getElementById(`avatar-opt-${charId}`);
    if(selectedEl) selectedEl.classList.add('selected');
}

function updateUI() {
    const list = document.getElementById('myCharList');
    const charBar = document.getElementById('char-bar');
    const selectFeed = document.getElementById('feedCharSelector');

    list.innerHTML = ""; charBar.innerHTML = ""; selectFeed.innerHTML = "";

    if(IS_ADMIN) {
        const narrHtml = `<div id="avatar-opt-narrateur" class="char-avatar-option" onclick="selectCharacter('narrateur')" title="Narrateur"><img src="https://cdn-icons-png.flaticon.com/512/1144/1144760.png"></div>`;
        charBar.innerHTML += narrHtml;
        const narrOpt = '<option value="Narrateur" data-id="narrateur" data-color="#ffffff" data-avatar="https://cdn-icons-png.flaticon.com/512/1144/1144760.png" data-role="Omniscient">Narrateur</option>';
        selectFeed.innerHTML = narrOpt;
    }

    myCharacters.forEach(char => {
        list.innerHTML += `<div class="char-item"><img src="${char.avatar}" class="mini-avatar"><div class="char-info"><div class="char-name-list" style="color:${char.color}">${char.name}</div><div class="char-role-list">${char.role}</div></div><div class="char-actions"><button class="btn-mini-action" onclick="prepareEditCharacter('${char._id}')"><i class="fa-solid fa-gear"></i></button><button class="btn-mini-action" onclick="deleteCharacter('${char._id}')" style="color:#da373c;"><i class="fa-solid fa-trash"></i></button></div></div>`;
        
        charBar.innerHTML += `<div id="avatar-opt-${char._id}" class="char-avatar-option" onclick="selectCharacter('${char._id}')" title="${char.name}"><img src="${char.avatar}"></div>`;
        
        const opt = document.createElement('option');
        opt.value = char.name; opt.text = char.name; opt.dataset.id = char._id; opt.dataset.color = char.color; opt.dataset.avatar = char.avatar; opt.dataset.role = char.role;
        selectFeed.appendChild(opt); 
    });

    if (!currentSelectedChar) {
        if(myCharacters.length > 0) selectCharacter(myCharacters[0]._id);
        else if(IS_ADMIN) selectCharacter('narrateur');
    } else {
        selectCharacter(currentSelectedChar._id);
    }
}

// --- PROFIL ---
function openProfile(charName) { socket.emit('get_char_profile', charName); }
function closeProfileModal() { document.getElementById('profile-modal').classList.add('hidden'); }
socket.on('char_profile_data', (char) => {
    document.getElementById('profileName').textContent = char.name;
    document.getElementById('profileRole').textContent = char.role;
    document.getElementById('profileAvatar').src = char.avatar;
    document.getElementById('profileDesc').textContent = char.description || "Aucune description.";
    document.getElementById('profileOwner').textContent = `Joué par : ${char.ownerUsername || "Inconnu"}`;
    document.getElementById('profile-modal').classList.remove('hidden');
    const btnDm = document.getElementById('btn-dm-profile');
    btnDm.innerHTML = `<i class="fa-solid fa-envelope"></i> Envoyer un MP`;
    btnDm.onclick = function() { closeProfileModal(); if (char.ownerUsername) openDm(char.ownerUsername); };
});

// --- ACTIONS MSG ---
function setContext(type, data) {
    currentContext = { type, data };
    const bar = document.getElementById('context-bar');
    const icon = document.getElementById('context-icon');
    const text = document.getElementById('context-text');
    bar.className = 'visible';
    document.getElementById('txtInput').focus();
    if (type === 'reply') { icon.innerHTML = '<i class="fa-solid fa-reply"></i>'; text.innerHTML = `Répondre à <strong>${data.author}</strong>`; }
    else if (type === 'edit') { icon.innerHTML = '<i class="fa-solid fa-pen"></i>'; text.innerHTML = `Modifier message`; document.getElementById('txtInput').value = data.content; }
}
function cancelContext() { currentContext = null; document.getElementById('context-bar').className = 'hidden'; document.getElementById('txtInput').value = ""; }
function triggerReply(id, author, content) { setContext('reply', { id, author, content }); }
function triggerEdit(id, content) { setContext('edit', { id, content }); }
function triggerDelete(id) { if(confirm("Supprimer ?")) socket.emit('delete_message', id); }

function sendMessage() {
    const txt = document.getElementById('txtInput');
    const content = txt.value.trim();
    if (!content) return;
    if (currentDmTarget) {
        socket.emit('send_dm', { sender: USERNAME, target: currentDmTarget, content: content, type: "text", date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) });
        txt.value = ''; cancelContext(); return;
    }
    if (content === "/clear") { if(IS_ADMIN) socket.emit('admin_clear_room', currentRoomId); txt.value = ''; return; }
    if (currentContext && currentContext.type === 'edit') { socket.emit('edit_message', { id: currentContext.data.id, newContent: content }); txt.value = ''; cancelContext(); return; }
    
    if(!currentSelectedChar) return alert("Sélectionnez un personnage !");

    socket.emit('message_rp', { 
        content, type: "text", 
        senderName: currentSelectedChar.name, 
        senderColor: currentSelectedChar.color || "#fff", 
        senderAvatar: currentSelectedChar.avatar, 
        senderRole: currentSelectedChar.role, 
        ownerId: PLAYER_ID, targetName: "", roomId: currentRoomId, 
        date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), 
        replyTo: (currentContext && currentContext.type === 'reply') ? { id: currentContext.data.id, author: currentContext.data.author, content: currentContext.data.content } : null 
    });
    txt.value = ''; cancelContext();
}

// --- DISPLAY CHAT ---
socket.on('history_data', (msgs) => { 
    if(currentDmTarget) return; 
    const container = document.getElementById('messages'); container.innerHTML = ""; 
    const splitId = firstUnreadMap[currentRoomId];
    msgs.forEach(msg => { if(splitId && msg._id === splitId) container.innerHTML += `<div class="new-msg-separator">-- Nouveaux --</div>`; displayMessage(msg); });
    if(firstUnreadMap[currentRoomId]) delete firstUnreadMap[currentRoomId];
    scrollToBottom(); 
});
socket.on('message_rp', (msg) => { 
    if (msg.ownerId !== PLAYER_ID && notificationsEnabled) notifSound.play().catch(e => {});
    if(msg.roomId === currentRoomId && !currentDmTarget) { displayMessage(msg); scrollToBottom(); } 
    else { unreadRooms.add(msg.roomId); if (!firstUnreadMap[msg.roomId]) firstUnreadMap[msg.roomId] = msg._id; updateRoomListUI(); }
});
socket.on('message_deleted', (msgId) => { const el = document.getElementById(`msg-${msgId}`); if(el) el.remove(); });
socket.on('message_updated', (data) => { const el = document.getElementById(`content-${data.id}`); if(el) { el.innerHTML = formatText(data.newContent); const meta = el.parentElement.parentElement.querySelector('.timestamp'); if(!meta.textContent.includes('(modifié)')) meta.textContent += ' (modifié)'; } });

function formatText(text) { if(!text) return ""; return text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\*(.*?)\*/g, '<i>$1</i>').replace(/\|\|(.*?)\|\|/g, '<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>'); }
function getYoutubeId(url) { const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/); return (match && match[2].length === 11) ? match[2] : null; }

function displayMessage(msg, isDm = false) {
    const div = document.createElement('div');
    div.className = 'message-container'; if(isDm) div.classList.add('dm-message'); div.id = `msg-${msg._id}`;
    let senderName, senderAvatar, senderColor, senderRole, canEdit = false, canDelete = false;
    
    if (isDm) {
        const realSender = msg.sender || msg.senderName; 
        senderName = realSender; 
        senderAvatar = `https://ui-avatars.com/api/?name=${realSender}&background=random&color=fff&size=64`; 
        senderColor = "#dbdee1"; 
        senderRole = "Utilisateur";
    } else {
        senderName = msg.senderName; senderAvatar = msg.senderAvatar; senderColor = msg.senderColor; senderRole = msg.senderRole; canEdit = (msg.ownerId === PLAYER_ID); canDelete = (msg.ownerId === PLAYER_ID) || IS_ADMIN;
    }

    if (!isDm && USERNAME && msg.content && msg.content.includes(`@${USERNAME}`)) {
        div.classList.add('mentioned');
    }

    let actionsHTML = "";
    if (!isDm) {
         actionsHTML += `<button class="action-btn" onclick="triggerReply('${msg._id}', '${senderName.replace(/'/g, "\\'")}', '${msg.content.replace(/'/g, "\\'")}')" title="Répondre"><i class="fa-solid fa-reply"></i></button>`;
         if (msg.type === 'text' && canEdit) actionsHTML += `<button class="action-btn" onclick="triggerEdit('${msg._id}', '${msg.content.replace(/'/g, "\\'")}')" title="Modifier"><i class="fa-solid fa-pen"></i></button>`;
         if (canDelete) actionsHTML += `<button class="action-btn" onclick="triggerDelete('${msg._id}')" style="color:#da373c;"><i class="fa-solid fa-trash"></i></button>`;
    }
    let replyHTML = "", spacingStyle = "";
    if (msg.replyTo && msg.replyTo.author) { spacingStyle = "margin-top: 15px;"; replyHTML = `<div class="reply-spine"></div><div class="reply-context-line" style="margin-left: 55px;"><span class="reply-name">@${msg.replyTo.author}</span><span class="reply-text">${msg.replyTo.content}</span></div>`; }
    let contentHTML = "";
    if (msg.type === "image") contentHTML = `<img src="${msg.content}" class="chat-image" onclick="window.open(this.src)">`;
    else if (msg.type === "video") {
        const ytId = getYoutubeId(msg.content);
        if (ytId) contentHTML = `<iframe class="video-frame" src="https://www.youtube.com/embed/${ytId}" allowfullscreen></iframe>`;
        else if (msg.content.match(/\.(mp4|webm|ogg)$/i)) contentHTML = `<video class="video-direct" controls><source src="${msg.content}"></video>`;
        else contentHTML = `<div class="text-body"><a href="${msg.content}" target="_blank" style="color:var(--accent)">[Lien Vidéo] ${msg.content}</a></div>`;
    } else contentHTML = `<div class="text-body" id="content-${msg._id}">${formatText(msg.content)}</div>`;
    const editedTag = msg.edited ? '<span class="edited-tag">(modifié)</span>' : '';
    const avatarClick = isDm ? "" : `onclick="openProfile('${senderName.replace(/'/g, "\\'")}')"`;
    div.innerHTML = `${replyHTML}<div class="msg-actions">${actionsHTML}</div><div style="position:relative; ${spacingStyle}"><img src="${senderAvatar}" class="avatar-img" ${avatarClick}><div style="margin-left: 55px;"><div class="char-header"><span class="char-name" style="color: ${senderColor}" ${avatarClick}>${senderName}</span><span class="char-role">${senderRole || ""}</span><span class="timestamp">${msg.date} ${editedTag}</span></div>${contentHTML}</div></div>`;
    document.getElementById('messages').appendChild(div);
}
function scrollToBottom() { const d = document.getElementById('messages'); d.scrollTop = d.scrollHeight; }
document.getElementById('txtInput').addEventListener('keyup', (e) => { if(e.key === 'Enter') sendMessage(); });

// --- SOCIAL FEED LOGIC ---

function loadFeed() { socket.emit('request_feed'); }
document.getElementById('postContent').addEventListener('input', (e) => { document.getElementById('char-count').textContent = `${e.target.value.length}/1000`; });

function submitPost() {
    const content = document.getElementById('postContent').value.trim();
    if(!content || content.length > 1000) return alert("Message vide ou trop long (max 1000).");
    const mediaUrl = document.getElementById('postMediaUrl').value.trim();
    
    let mediaType = null;
    if(mediaUrl) {
        if(getYoutubeId(mediaUrl) || mediaUrl.match(/\.(mp4|webm|ogg)$/i)) mediaType = 'video';
        else mediaType = 'image';
    }

    const sel = document.getElementById('feedCharSelector');
    if(sel.options.length === 0) return alert("Créez un personnage d'abord !");
    const opt = sel.options[sel.selectedIndex];

    const postData = {
        authorName: opt.value, authorAvatar: opt.dataset.avatar, authorRole: opt.dataset.role,
        content: content, mediaUrl: mediaUrl, mediaType: mediaType, date: new Date().toLocaleDateString(), ownerId: PLAYER_ID
    };
    socket.emit('create_post', postData);
    document.getElementById('postContent').value = ""; document.getElementById('postMediaUrl').value = ""; document.getElementById('char-count').textContent = "0/1000";
}

function toggleLike(postId) { if(!PLAYER_ID) return alert("Connectez-vous !"); socket.emit('like_post', { postId, userId: PLAYER_ID }); }
function deletePost(postId) { if(confirm("Supprimer ce post ?")) socket.emit('delete_post', postId); }

// Detail Modal
let currentDetailPostId = null;
function openPostDetail(postId) {
    const postEl = document.getElementById(`post-${postId}`);
    if(!postEl) return;
    currentDetailPostId = postId;
    const contentClone = postEl.cloneNode(true);
    contentClone.onclick = null; 
    contentClone.style.border = "none"; contentClone.classList.remove('highlight-new');
    const oldComments = contentClone.querySelector('.comments-section');
    if(oldComments) oldComments.remove(); 
    const detailContent = document.getElementById('post-detail-content');
    detailContent.innerHTML = "";
    detailContent.appendChild(contentClone);
    const commentsListDiv = document.getElementById('post-detail-comments-list');
    commentsListDiv.innerHTML = "";
    const feedComments = postEl.querySelector('.comments-list')?.innerHTML || "";
    commentsListDiv.innerHTML = feedComments;
    document.getElementById('post-detail-modal').classList.remove('hidden');
    
    document.getElementById('btn-detail-comment').onclick = () => {
        const txt = document.getElementById('post-detail-comment-input').value.trim();
        if(!txt) return;
        const sel = document.getElementById('feedCharSelector');
        if(sel.options.length === 0) return alert("Perso requis");
        socket.emit('post_comment', { postId, comment: { authorName: sel.options[sel.selectedIndex].value, authorAvatar: sel.options[sel.selectedIndex].dataset.avatar, content: txt, date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), ownerId: PLAYER_ID } });
        document.getElementById('post-detail-comment-input').value = "";
    };
}
function closePostDetail() { document.getElementById('post-detail-modal').classList.add('hidden'); currentDetailPostId = null; }

function deleteComment(postId, commentId) {
    if(confirm("Supprimer commentaire ?")) socket.emit('delete_comment', { postId, commentId });
}

// SOCKET FEED
socket.on('feed_data', (posts) => {
    const container = document.getElementById('feed-stream'); container.innerHTML = "";
    posts.forEach(post => container.appendChild(createPostElement(post)));
});
socket.on('new_post', (post) => {
    if(currentView !== 'feed') document.getElementById('feed-notif-dot').classList.remove('hidden');
    const container = document.getElementById('feed-stream');
    const el = createPostElement(post);
    if(currentView === 'feed' || new Date(post.timestamp) > lastFeedVisit) el.classList.add('highlight-new');
    container.prepend(el);
});
socket.on('post_updated', (post) => {
    const existing = document.getElementById(`post-${post._id}`);
    if(existing) existing.replaceWith(createPostElement(post));
    if(currentDetailPostId === post._id) {
        const detailLikeBtn = document.querySelector('#post-detail-content .action-item');
        if(detailLikeBtn) detailLikeBtn.innerHTML = `<i class="fa-solid fa-heart"></i> ${post.likes.length}`;
        const list = document.getElementById('post-detail-comments-list');
        list.innerHTML = generateCommentsHTML(post.comments, post._id);
    }
});
socket.on('post_deleted', (postId) => {
    const el = document.getElementById(`post-${postId}`); if(el) el.remove();
    if(currentDetailPostId === postId) closePostDetail();
});

function generateCommentsHTML(comments, postId) {
    let html = "";
    comments.forEach(c => {
        const delBtn = IS_ADMIN ? `<span style="color:#da373c; cursor:pointer; margin-left:10px;" onclick="deleteComment('${postId}', '${c.id}')"><i class="fa-solid fa-xmark"></i></span>` : "";
        html += `<div class="comment-item">
            <div class="comment-bubble">
                <div class="comment-meta"><img src="${c.authorAvatar}" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:5px;"><span class="comment-author">${c.authorName}</span><span>${c.date}</span></div>
                <div style="margin-left:25px;">${c.content} ${delBtn}</div>
            </div>
        </div>`;
    });
    return html;
}

function createPostElement(post) {
    const div = document.createElement('div');
    div.className = 'post-card'; div.id = `post-${post._id}`;
    
    const isLiked = post.likes.includes(PLAYER_ID);
    const likeClass = isLiked ? 'liked' : '';
    const isOwner = (post.ownerId === PLAYER_ID);
    const canDelete = IS_ADMIN || isOwner;
    const deleteBtn = canDelete ? `<button class="btn-danger-small" style="position:absolute; top:10px; right:10px; border:none; background:none; cursor:pointer;" onclick="event.stopPropagation(); deletePost('${post._id}')"><i class="fa-solid fa-trash"></i></button>` : '';

    let mediaHTML = "";
    if(post.mediaUrl) {
        if(post.mediaType === 'video') {
             const ytId = getYoutubeId(post.mediaUrl);
             if(ytId) mediaHTML = `<iframe class="post-media" src="https://www.youtube.com/embed/${ytId}" frameborder="0" allowfullscreen></iframe>`;
             else mediaHTML = `<video class="post-media" controls src="${post.mediaUrl}"></video>`;
        } else {
            mediaHTML = `<img src="${post.mediaUrl}" class="post-media">`;
        }
    }

    const commentsHTML = generateCommentsHTML(post.comments, post._id);

    div.innerHTML = `
        ${deleteBtn}
        <div class="post-header" onclick="openProfile('${post.authorName.replace(/'/g, "\\'")}')">
            <img src="${post.authorAvatar}" class="post-avatar">
            <div class="post-meta">
                <span class="post-author">${post.authorName}</span>
                <span class="post-role">${post.authorRole}</span>
            </div>
            <span class="post-date">${post.date}</span>
        </div>
        <div class="post-content" onclick="openPostDetail('${post._id}')">${formatText(post.content)}</div>
        ${mediaHTML}
        <div class="post-actions">
            <button class="action-item ${likeClass}" onclick="event.stopPropagation(); toggleLike('${post._id}')"><i class="fa-solid fa-heart"></i> ${post.likes.length}</button>
            <button class="action-item" onclick="event.stopPropagation(); openPostDetail('${post._id}')"><i class="fa-solid fa-comment"></i> ${post.comments.length}</button>
        </div>
        <div class="comments-list hidden">${commentsHTML}</div>
    `;
    return div;
}
