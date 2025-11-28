var socket = io();
let myCharacters = [];
let allRooms = []; 
let allPosts = []; // Stockage local des posts
let currentRoomId = 'global'; 
let currentDmTarget = null; // Pour filtrer la vue conversation MP
let PLAYER_ID; 
let USERNAME; 
let IS_ADMIN = false;
let currentContext = null; 
let typingTimeout = null;
let unreadRooms = new Set();
let dmList = new Set(); // Liste des gens avec qui j'ai un MP
let firstUnreadMap = {}; 
let currentView = 'chat'; // 'chat' ou 'feed'
let currentPostId = null; // Post ouvert en détail

// --- NAVIGATION SPA ---
function switchView(view) {
    currentView = view;
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    
    if (view === 'chat') {
        document.getElementById('view-chat').classList.remove('hidden');
        document.getElementById('btn-view-chat').classList.add('active');
        scrollToBottom();
    } else if (view === 'feed') {
        document.getElementById('view-feed').classList.remove('hidden');
        document.getElementById('btn-view-feed').classList.add('active');
        document.getElementById('btn-view-feed').classList.remove('notif-active'); // Clear notif
        // Reset vue détail
        closePostDetail();
    }
}

// --- UI & LOGIN / COMPTE ---
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('mobile-overlay').classList.toggle('open'); }
function toggleCreateForm() { document.getElementById('create-char-form').classList.toggle('hidden'); }

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
    input.type = (input.type === "password") ? "text" : "password";
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
    const btn = document.getElementById('btn-account-main');
    btn.textContent = "👤 Mon Profil";
    btn.style.background = "#2b2d31";
    closeLoginModal();
    socket.emit('request_initial_data', PLAYER_ID);
    joinRoom('global');
});

socket.on('login_error', (msg) => {
    const errorEl = document.getElementById('login-error-msg');
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
});

socket.on('username_change_success', (newName) => {
    USERNAME = newName;
    localStorage.setItem('rp_username', newName);
    document.getElementById('player-id-display').textContent = `Compte : ${USERNAME}`;
    const msgEl = document.getElementById('settings-msg');
    msgEl.textContent = "Pseudo mis à jour !";
    msgEl.style.color = "#23a559";
});

socket.on('username_change_error', (msg) => {
    const msgEl = document.getElementById('settings-msg');
    msgEl.textContent = msg;
    msgEl.style.color = "#da373c";
});

function checkAutoLogin() {
    const savedUser = localStorage.getItem('rp_username');
    const savedCode = localStorage.getItem('rp_code');
    if (savedUser && savedCode) {
        socket.emit('login_request', { username: savedUser, code: savedCode });
    } else {
        openLoginModal();
    }
}

// --- SOCKET CONNECT ---
socket.on('connect', () => { checkAutoLogin(); });

socket.on('update_user_list', (users) => {
    const listDiv = document.getElementById('online-users-list');
    const countSpan = document.getElementById('online-count');
    listDiv.innerHTML = "";
    countSpan.textContent = users.length;
    users.forEach(u => listDiv.innerHTML += `<div class="online-user"><span class="status-dot"></span><span>${u}</span></div>`);
});

socket.on('force_history_refresh', (data) => { if (currentRoomId === data.roomId) socket.emit('request_history', { roomId: currentRoomId, userId: PLAYER_ID }); });

// --- MEDIAS ---
function previewFile(type) {
    const fileInput = document.getElementById(type === 'new' ? 'newCharFile' : 'editCharFile');
    const hiddenInput = document.getElementById(type === 'new' ? 'newCharBase64' : 'editCharBase64');
    const file = fileInput.files[0];
    if (file) {
        if (file.size > 2 * 1024 * 1024) { alert("Max 2 Mo"); fileInput.value = ""; return; }
        const reader = new FileReader();
        reader.onloadend = function() { hiddenInput.value = reader.result; }
        reader.readAsDataURL(file);
    }
}

function openUrlModal() { document.getElementById('url-modal').classList.remove('hidden'); }
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
    const sel = document.getElementById('charSelector'); 
    if(sel.options.length === 0) return alert("Créez un personnage d'abord !");
    const opt = sel.options[sel.selectedIndex];
    
    // Si on est en mode MP
    let targetName = "";
    if (currentContext && currentContext.type === 'dm') targetName = currentContext.data.target;
    else if (currentDmTarget) targetName = currentDmTarget;

    socket.emit('message_rp', { 
        content: content, type: type, 
        senderName: opt.value, senderColor: opt.dataset.color, senderAvatar: opt.dataset.avatar, senderRole: opt.dataset.role, 
        ownerId: PLAYER_ID, 
        targetName: targetName,
        roomId: currentRoomId, 
        date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), 
        replyTo: (currentContext && currentContext.type === 'reply') ? { id: currentContext.data.id, author: currentContext.data.author, content: currentContext.data.content } : null
    });
    
    cancelContext();
}

// --- TYPING ---
const txtInput = document.getElementById('txtInput');
txtInput.addEventListener('input', () => {
    const sel = document.getElementById('charSelector');
    const name = sel.options[sel.selectedIndex]?.text || "Quelqu'un";
    socket.emit('typing_start', { roomId: currentRoomId, charName: name });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { socket.emit('typing_stop', { roomId: currentRoomId, charName: name }); }, 1000);
});
socket.on('display_typing', (data) => { if(data.roomId === currentRoomId) { document.getElementById('typing-indicator').classList.remove('hidden'); document.getElementById('typing-text').textContent = `${data.charName} écrit...`; } });
socket.on('hide_typing', (data) => { if(data.roomId === currentRoomId) document.getElementById('typing-indicator').classList.add('hidden'); });

// --- SALONS ---
function createRoomPrompt() {
    const name = prompt("Nom du salon :");
    if (name) socket.emit('create_room', { name, creatorId: PLAYER_ID, allowedCharacters: [] });
}
function deleteRoom(roomId) { if(confirm("ADMIN : Supprimer ?")) socket.emit('delete_room', roomId); }

function joinRoom(roomId) {
    if (currentRoomId && currentRoomId !== roomId) socket.emit('leave_room', currentRoomId);
    currentRoomId = roomId;
    currentDmTarget = null; // Reset MP filter
    
    socket.emit('join_room', currentRoomId);
    if (unreadRooms.has(currentRoomId)) unreadRooms.delete(currentRoomId);

    const room = allRooms.find(r => r._id === roomId);
    updateChatHeader(room ? room.name : 'Salon Global', false);
    
    document.getElementById('messages').innerHTML = ""; 
    document.getElementById('typing-indicator').classList.add('hidden');
    
    socket.emit('request_history', { roomId: currentRoomId, userId: PLAYER_ID });
    cancelContext();
    if(window.innerWidth <= 768) { document.getElementById('sidebar').classList.remove('open'); document.getElementById('mobile-overlay').classList.remove('open'); }
    updateRoomListUI();
    updateDmListUI(); // Reset visual selection
}
socket.on('rooms_data', (rooms) => { allRooms = rooms; updateRoomListUI(); });

function updateRoomListUI() {
    const list = document.getElementById('roomList');
    list.innerHTML = `<div class="room-item ${currentRoomId === 'global' && !currentDmTarget ? 'active' : ''} ${unreadRooms.has('global')?'unread':''}" onclick="joinRoom('global')"><span class="room-name">Salon Global</span></div>`;
    allRooms.forEach(room => {
        const delBtn = IS_ADMIN ? `<button class="btn-del-room" onclick="event.stopPropagation(); deleteRoom('${room._id}')">✕</button>` : '';
        const isUnread = unreadRooms.has(room._id) ? 'unread' : '';
        const isActive = (currentRoomId === room._id && !currentDmTarget) ? 'active' : '';
        list.innerHTML += `<div class="room-item ${isActive} ${isUnread}" onclick="joinRoom('${room._id}')"><span class="room-name">${room.name}</span>${delBtn}</div>`;
    });
}

// --- PERSONNAGES ---
function createCharacter() {
    const name = document.getElementById('newCharName').value.trim();
    const role = document.getElementById('newCharRole').value.trim();
    const desc = document.getElementById('newCharDesc').value.trim();
    const color = document.getElementById('newCharColor').value;
    let avatar = document.getElementById('newCharBase64').value;
    if(!avatar) avatar = `https://ui-avatars.com/api/?name=${name}&background=random`;
    if(!name || !role) return alert("Nom et Rôle requis");
    socket.emit('create_char', { name, role, color, avatar, description: desc, ownerId: PLAYER_ID });
    toggleCreateForm();
    document.getElementById('newCharBase64').value = "";
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
    document.getElementById('editCharBase64').value = "";
    document.getElementById('edit-char-form').classList.remove('hidden');
    document.getElementById('create-char-form').classList.add('hidden');
}

function cancelEditCharacter() { document.getElementById('edit-char-form').classList.add('hidden'); }
function submitEditCharacter() {
    const charId = document.getElementById('editCharId').value;
    const originalName = document.getElementById('editCharOriginalName').value;
    const newName = document.getElementById('editCharName').value.trim();
    const newRole = document.getElementById('editCharRole').value.trim();
    const newColor = document.getElementById('editCharColor').value;
    const newDesc = document.getElementById('editCharDesc').value.trim();
    let newAvatar = document.getElementById('editCharBase64').value;
    if(!newAvatar) { const char = myCharacters.find(c => c._id === charId); if(char) newAvatar = char.avatar; }
    socket.emit('edit_char', { charId, originalName, newName, newRole, newAvatar, newColor, newDescription: newDesc, ownerId: PLAYER_ID, currentRoomId: currentRoomId });
    cancelEditCharacter();
}

socket.on('my_chars_data', (chars) => { myCharacters = chars; updateUI(); });
socket.on('char_created_success', (char) => { myCharacters.push(char); updateUI(); });
function deleteCharacter(id) { if(confirm('Supprimer ?')) socket.emit('delete_char', id); }
socket.on('char_deleted_success', (id) => { myCharacters = myCharacters.filter(c => c._id !== id); updateUI(); });

function updateUI() {
    const list = document.getElementById('myCharList');
    const select = document.getElementById('charSelector');
    const feedSelect = document.getElementById('feedCharSelector');
    const commentSelect = document.getElementById('commentCharSelector');
    
    let selectedCharId = null;
    if (select.selectedIndex >= 0) selectedCharId = select.options[select.selectedIndex].dataset.id; 

    list.innerHTML = "";
    select.innerHTML = ""; feedSelect.innerHTML = ""; commentSelect.innerHTML = "";
    
    if(IS_ADMIN) {
        const narrateurOpt = '<option value="Narrateur" data-id="narrateur" data-color="#ffffff" data-avatar="https://cdn-icons-png.flaticon.com/512/1144/1144760.png" data-role="Omniscient">Narrateur</option>';
        select.innerHTML = narrateurOpt; feedSelect.innerHTML = narrateurOpt; commentSelect.innerHTML = narrateurOpt;
    }

    myCharacters.forEach(char => {
        list.innerHTML += `
            <div class="char-item">
                <img src="${char.avatar}" class="mini-avatar">
                <div class="char-info">
                    <div class="char-name-list" style="color:${char.color}">${char.name}</div>
                    <div class="char-role-list">${char.role}</div>
                </div>
                <div class="char-actions">
                    <button class="btn-mini-action" onclick="prepareEditCharacter('${char._id}')">⚙️</button>
                    <button class="btn-mini-action" onclick="deleteCharacter('${char._id}')" style="color:#da373c;">✕</button>
                </div>
            </div>`;
        
        const optText = `<option value="${char.name}" data-id="${char._id}" data-color="${char.color}" data-avatar="${char.avatar}" data-role="${char.role}">${char.name}</option>`;
        select.innerHTML += optText;
        feedSelect.innerHTML += optText;
        commentSelect.innerHTML += optText;
    });
    
    if(selectedCharId) {
        const optionToSelect = Array.from(select.options).find(o => o.dataset.id === selectedCharId);
        if(optionToSelect) optionToSelect.selected = true;
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
    
    const btnDM = document.getElementById('btn-dm-profile');
    if (char.ownerId === PLAYER_ID) {
        btnDM.style.display = 'none';
    } else {
        btnDM.style.display = 'block';
        btnDM.onclick = function() {
            openDMConversation(char.name); // Nouvelle fonction d'ouverture de MP
            closeProfileModal();
        };
    }
    
    document.getElementById('profile-modal').classList.remove('hidden');
});

// --- ACTIONS (CONTEXTE MP / EDIT / REPLY) ---
function setContext(type, data) {
    currentContext = { type, data };
    const bar = document.getElementById('context-bar');
    const icon = document.getElementById('context-icon');
    const text = document.getElementById('context-text');
    
    bar.className = 'visible';
    bar.classList.remove('dm-context');

    if (type === 'reply') { 
        icon.textContent = "↩️"; 
        text.innerHTML = `Répondre à <strong>${data.author}</strong>`; 
    }
    else if (type === 'edit') { 
        icon.textContent = "✏️"; 
        text.innerHTML = `Modifier message`; 
        document.getElementById('txtInput').value = data.content; 
    }
    else if (type === 'dm') {
        icon.textContent = "🔒";
        text.innerHTML = `Message privé pour <strong>${data.target}</strong>`;
        bar.classList.add('dm-context');
    }

    document.getElementById('txtInput').focus();
}

function triggerDM(charName) { setContext('dm', { target: charName }); }
function cancelContext() {
    currentContext = null; 
    document.getElementById('context-bar').className = 'hidden';
    if(document.getElementById('txtInput').value !== "") document.getElementById('txtInput').value = "";
}
function triggerReply(id, author, content) { setContext('reply', { id, author, content }); }
function triggerEdit(id, content) { setContext('edit', { id, content }); }
function triggerDelete(id) { if(confirm("Supprimer ?")) socket.emit('delete_message', id); }

function sendMessage() {
    const txt = document.getElementById('txtInput');
    const content = txt.value.trim();
    if (!content) return;
    if (content === "/clear") { if(IS_ADMIN) socket.emit('admin_clear_room', currentRoomId); txt.value = ''; return; }
    if (currentContext && currentContext.type === 'edit') { socket.emit('edit_message', { id: currentContext.data.id, newContent: content }); txt.value = ''; cancelContext(); return; }

    const sel = document.getElementById('charSelector');
    if (sel.options.length === 0) { alert("Créez un personnage d'abord !"); return; }
    const opt = sel.options[sel.selectedIndex];
    
    let targetName = "";
    if (currentContext && currentContext.type === 'dm') targetName = currentContext.data.target;
    else if (currentDmTarget) targetName = currentDmTarget; // Si on est en mode conversation MP

    const msg = {
        content, type: "text",
        senderName: opt.value, senderColor: opt.dataset.color || "#fff", senderAvatar: opt.dataset.avatar, senderRole: opt.dataset.role,
        ownerId: PLAYER_ID, 
        targetName: targetName, 
        roomId: currentRoomId,
        date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
        replyTo: (currentContext && currentContext.type === 'reply') ? { id: currentContext.data.id, author: currentContext.data.author, content: currentContext.data.content } : null
    };
    socket.emit('message_rp', msg);
    txt.value = ''; cancelContext();
}

// --- GESTION AVANCEE DES MP ---
function openDMConversation(targetName) {
    if(window.innerWidth <= 768) toggleSidebar(); // Fermer menu mobile si ouvert
    currentDmTarget = targetName;
    
    // Mettre à jour l'UI
    updateChatHeader(`Privé : ${targetName}`, true);
    updateDmListUI();
    updateRoomListUI(); // Désélectionner le salon
    
    // Relancer la demande d'historique pour filtrer
    socket.emit('request_history', { roomId: currentRoomId, userId: PLAYER_ID });
    
    // Ajouter à la liste visuelle si pas présent
    if(!dmList.has(targetName)) {
        dmList.add(targetName);
        updateDmListUI();
    }
}

function closeDMConversation() {
    const target = currentDmTarget;
    currentDmTarget = null;
    dmList.delete(target);
    updateDmListUI();
    joinRoom('global'); // Retour au global
}

function deleteDMHistory() {
    if(confirm("ATTENTION : Cela supprimera définitivement tous les messages échangés avec ce personnage pour les deux parties. Continuer ?")) {
        socket.emit('dm_delete_history', { userId: PLAYER_ID, targetName: currentDmTarget });
    }
}

function updateChatHeader(title, isDm) {
    document.getElementById('currentRoomName').textContent = title;
    const actions = document.getElementById('dm-header-actions');
    actions.style.display = isDm ? 'flex' : 'none';
}

function updateDmListUI() {
    const list = document.getElementById('dmList');
    list.innerHTML = "";
    dmList.forEach(name => {
        const isActive = (currentDmTarget === name) ? 'active' : '';
        list.innerHTML += `<div class="dm-item ${isActive}" onclick="openDMConversation('${name}')"><span>${name}</span></div>`;
    });
}

// --- DISPLAY CHAT ---
socket.on('history_data', (msgs) => { 
    const container = document.getElementById('messages');
    container.innerHTML = ""; 
    // Filtrage Client pour le mode Conversation
    let filteredMsgs = msgs;
    if (currentDmTarget) {
        filteredMsgs = msgs.filter(m => 
            (m.senderName === currentDmTarget && m.targetOwnerId === PLAYER_ID) || 
            (m.targetName === currentDmTarget && m.ownerId === PLAYER_ID)
        );
    } else {
        // En mode salon, on cache les MP qui ne sont pas dans le flux contextuel (optionnel, mais plus propre)
        // Ici on garde le comportement par défaut : afficher les MP mélangés ou pas ?
        // Le serveur envoie tout ce qui me concerne. Pour la clarté, si je ne suis pas en mode focus MP,
        // je vois les salons publics + mes MPs reçus/envoyés comme avant.
    }

    filteredMsgs.forEach(msg => {
        displayMessage(msg); 
        // Ajouter les interlocuteurs à la DM List latérale
        if (msg.targetName) {
            const other = (msg.ownerId === PLAYER_ID) ? msg.targetName : msg.senderName;
            if (other && !dmList.has(other)) dmList.add(other);
        }
    });
    updateDmListUI();
    scrollToBottom(); 
});

socket.on('message_rp', (msg) => { 
    if (msg.targetName && msg.ownerId !== PLAYER_ID && msg.targetOwnerId !== PLAYER_ID) return;

    // Gestion DM List
    if (msg.targetName) {
        const other = (msg.ownerId === PLAYER_ID) ? msg.targetName : msg.senderName;
        if (!dmList.has(other)) { dmList.add(other); updateDmListUI(); }
    }

    // Filtrage visuel selon si on est en mode focus MP ou pas
    if (currentDmTarget) {
        // Si je suis focus sur "Pedro", je ne veux voir que les messages de/pour Pedro
        const isRelated = (msg.senderName === currentDmTarget || msg.targetName === currentDmTarget);
        if (isRelated) { displayMessage(msg); scrollToBottom(); }
    } else {
        // Mode Salon normal
        if(msg.roomId === currentRoomId) { 
            displayMessage(msg); scrollToBottom(); 
        } else {
            unreadRooms.add(msg.roomId);
            updateRoomListUI();
        }
    }
});

socket.on('message_deleted', (msgId) => { const el = document.getElementById(`msg-${msgId}`); if(el) el.remove(); });
socket.on('message_updated', (data) => {
    const el = document.getElementById(`content-${data.id}`);
    if(el) { el.innerHTML = formatText(data.newContent); const meta = el.parentElement.parentElement.querySelector('.timestamp'); if(!meta.textContent.includes('(modifié)')) meta.textContent += ' (modifié)'; }
});

function formatText(text) {
    if(!text) return "";
    return text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\*(.*?)\*/g, '<i>$1</i>').replace(/\|\|(.*?)\|\|/g, '<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>');
}

function getYoutubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

function displayMessage(msg) {
    const div = document.createElement('div');
    div.className = 'message-container'; div.id = `msg-${msg._id}`;
    
    let privateBadge = "";
    if (msg.targetName) {
        div.classList.add('dm-message');
        if (msg.ownerId === PLAYER_ID) privateBadge = `<span class="private-badge" style="background:var(--dm-color); margin-right:5px;">🔒 Privé à ${msg.targetName}</span>`;
        else privateBadge = `<span class="private-badge" style="background:var(--dm-color); margin-right:5px;">🔒 Privé de ${msg.senderName}</span>`;
    }

    const canEdit = (msg.ownerId === PLAYER_ID);
    const canDelete = (msg.ownerId === PLAYER_ID) || IS_ADMIN;

    let actionsHTML = `<button class="action-btn" onclick="triggerReply('${msg._id}', '${msg.senderName.replace(/'/g, "\\'")}', '${msg.content.replace(/'/g, "\\'")}')" title="Répondre">↩️</button>`;
    if (msg.ownerId !== PLAYER_ID) actionsHTML += `<button class="action-btn" onclick="openDMConversation('${msg.senderName.replace(/'/g, "\\'")}')" title="Message Privé">✉️</button>`;
    if (msg.type === 'text' && canEdit) actionsHTML += `<button class="action-btn" onclick="triggerEdit('${msg._id}', '${msg.content.replace(/'/g, "\\'")}')" title="Modifier">✏️</button>`;
    if (canDelete) actionsHTML += `<button class="action-btn" onclick="triggerDelete('${msg._id}')" style="color:#da373c;">🗑️</button>`;

    let replyHTML = "", spacingStyle = "";
    if (msg.replyTo && msg.replyTo.author) { spacingStyle = "margin-top: 15px;"; replyHTML = `<div class="reply-spine"></div><div class="reply-context-line" style="margin-left: 55px;"><span class="reply-name">@${msg.replyTo.author}</span><span class="reply-text">${msg.replyTo.content}</span></div>`; }
    
    let contentHTML = "";
    if (msg.type === "image") {
        contentHTML = `<img src="${msg.content}" class="chat-image" onclick="window.open(this.src)">`;
    } else if (msg.type === "video") {
        const ytId = getYoutubeId(msg.content);
        if (ytId) contentHTML = `<iframe class="video-frame" src="https://www.youtube.com/embed/${ytId}" allowfullscreen></iframe>`;
        else if (msg.content.match(/\.(mp4|webm|ogg)$/i)) contentHTML = `<video class="video-direct" controls><source src="${msg.content}">Votre navigateur ne supporte pas la vidéo.</video>`;
        else contentHTML = `<div class="text-body"><a href="${msg.content}" target="_blank" style="color:var(--accent)">[Lien Vidéo] ${msg.content}</a></div>`;
    } else {
        contentHTML = `<div class="text-body" id="content-${msg._id}">${formatText(msg.content)}</div>`;
    }

    const editedTag = msg.edited ? '<span class="edited-tag">(modifié)</span>' : '';

    div.innerHTML = `${replyHTML}<div class="msg-actions">${actionsHTML}</div><div style="position:relative; ${spacingStyle}"><img src="${msg.senderAvatar}" class="avatar-img" onclick="openProfile('${msg.senderName.replace(/'/g, "\\'")}')"><div style="margin-left: 55px;"><div class="char-header">${privateBadge}<span class="char-name" style="color: ${msg.senderColor}" onclick="openProfile('${msg.senderName.replace(/'/g, "\\'")}')">${msg.senderName}</span><span class="char-role">${msg.senderRole || ""}</span><span class="timestamp">${msg.date} ${editedTag}</span></div>${contentHTML}</div></div>`;
    document.getElementById('messages').appendChild(div);
}

function scrollToBottom() { const d = document.getElementById('messages'); d.scrollTop = d.scrollHeight; }
document.getElementById('txtInput').addEventListener('keyup', (e) => { if(e.key === 'Enter') sendMessage(); });


// --- SECTION POSTS (FEED) ---

socket.on('posts_data', (posts) => {
    allPosts = posts;
    renderFeed();
});

socket.on('new_post', (post) => {
    allPosts.unshift(post);
    renderFeed();
    // Notification
    if (currentView !== 'feed') {
        document.getElementById('btn-view-feed').classList.add('notif-active');
    }
    // Highlight
    setTimeout(() => {
        const el = document.querySelector(`.post-card[data-id="${post._id}"]`);
        if(el) {
            el.classList.add('new-post-highlight');
            setTimeout(() => el.classList.remove('new-post-highlight'), 3000);
        }
    }, 100);
});

socket.on('post_deleted', (id) => {
    allPosts = allPosts.filter(p => p._id !== id);
    renderFeed();
    if(currentPostId === id) closePostDetail();
});

socket.on('post_updated', (updatedPost) => {
    const index = allPosts.findIndex(p => p._id === updatedPost._id);
    if(index !== -1) allPosts[index] = updatedPost;
    renderFeed();
    if(currentPostId === updatedPost._id) openPostDetail(updatedPost); // Refresh detail
});

socket.on('reload_posts', () => { socket.emit('request_initial_data', null); });

function renderFeed() {
    const container = document.getElementById('feed-stream');
    container.innerHTML = "";
    allPosts.forEach(post => {
        const canDelete = (post.ownerId === PLAYER_ID || IS_ADMIN);
        let mediaHTML = getMediaHTML(post);
        const delBtn = canDelete ? `<button class="post-action delete-post-btn" onclick="deletePost(event, '${post._id}')">🗑️</button>` : '';
        const likeClass = post.likes.includes(PLAYER_ID) ? 'liked' : '';
        
        const html = `
        <div class="post-card" data-id="${post._id}" onclick="clickPost('${post._id}')">
            <div class="post-header">
                <img src="${post.authorAvatar}" class="post-avatar" onclick="event.stopPropagation(); openProfile('${post.authorName.replace(/'/g, "\\'")}')">
                <div>
                    <div class="post-author" style="color:${post.authorColor || '#fff'}" onclick="event.stopPropagation(); openProfile('${post.authorName.replace(/'/g, "\\'")}')">${post.authorName}</div>
                    <div style="font-size:0.7em; color:#888;">${post.authorRole}</div>
                </div>
                <div class="post-date">${post.date}</div>
            </div>
            <div class="post-content">${formatText(post.content)}</div>
            ${mediaHTML}
            <div class="post-footer">
                <button class="post-action ${likeClass} juicy-btn" onclick="likePost(event, '${post._id}')">❤️ ${post.likes.length}</button>
                <button class="post-action juicy-btn">💬 ${post.comments.length}</button>
                ${delBtn}
            </div>
        </div>`;
        container.innerHTML += html;
    });
}

function getMediaHTML(post) {
    if(!post.mediaUrl) return "";
    if(post.mediaType === 'image') return `<img src="${post.mediaUrl}" class="post-media" onclick="event.stopPropagation(); window.open(this.src)">`;
    if(post.mediaType === 'video') {
         const ytId = getYoutubeId(post.mediaUrl);
         if(ytId) return `<div onclick="event.stopPropagation()"><iframe class="video-frame" src="https://www.youtube.com/embed/${ytId}" allowfullscreen></iframe></div>`;
         return `<div onclick="event.stopPropagation()"><video class="video-direct" controls><source src="${post.mediaUrl}"></video></div>`;
    }
    return "";
}

function clickPost(id) {
    const post = allPosts.find(p => p._id === id);
    if(post) openPostDetail(post);
}

function openPostDetail(post) {
    currentPostId = post._id;
    document.getElementById('feed-view').classList.add('hidden');
    document.getElementById('post-view').classList.remove('hidden');
    
    // Render detail
    const container = document.getElementById('post-detail-container');
    const canDelete = (post.ownerId === PLAYER_ID || IS_ADMIN);
    let mediaHTML = getMediaHTML(post);
    const likeClass = post.likes.includes(PLAYER_ID) ? 'liked' : '';
    
    container.innerHTML = `
        <div class="post-card">
            <div class="post-header">
                <img src="${post.authorAvatar}" class="post-avatar" onclick="openProfile('${post.authorName.replace(/'/g, "\\'")}')">
                <div>
                    <div class="post-author" style="color:${post.authorColor}">${post.authorName}</div>
                    <div style="font-size:0.7em; color:#888;">${post.authorRole}</div>
                </div>
                <div class="post-date">${post.date}</div>
            </div>
            <div class="post-content" style="font-size:1.1em;">${formatText(post.content)}</div>
            ${mediaHTML}
            <div class="post-footer">
                <button class="post-action ${likeClass} juicy-btn" onclick="likePost(event, '${post._id}')">❤️ ${post.likes.length}</button>
                <button class="post-action">💬 ${post.comments.length}</button>
            </div>
        </div>
    `;

    // Render comments
    const list = document.getElementById('comments-list');
    list.innerHTML = "";
    post.comments.forEach(c => {
        const canDelCom = (c.ownerId === PLAYER_ID || IS_ADMIN);
        const delBtn = canDelCom ? `<span style="cursor:pointer; color:#da373c; float:right;" onclick="deleteComment('${post._id}', '${c.id}')">✕</span>` : '';
        list.innerHTML += `
            <div class="comment-item">
                <img src="${c.authorAvatar}" class="comment-avatar" onclick="openProfile('${c.authorName.replace(/'/g, "\\'")}')">
                <div class="comment-body">
                    <div class="comment-header"><span style="cursor:pointer;" onclick="openProfile('${c.authorName.replace(/'/g, "\\'")}')">${c.authorName}</span> <span class="comment-date">${c.date} ${delBtn}</span></div>
                    <div>${formatText(c.content)}</div>
                </div>
            </div>
        `;
    });
}

function closePostDetail() {
    currentPostId = null;
    document.getElementById('post-view').classList.add('hidden');
    document.getElementById('feed-view').classList.remove('hidden');
}

function submitPost() {
    const sel = document.getElementById('feedCharSelector');
    if(!sel.value) return alert("Choisissez un personnage");
    const opt = sel.options[sel.selectedIndex];
    
    const content = document.getElementById('postContent').value.trim();
    if(!content) return;
    
    const mediaUrl = document.getElementById('postMediaUrl').value.trim();
    let mediaType = null;
    if(mediaUrl) {
        if(mediaUrl.match(/\.(jpeg|jpg|gif|png|webp)$/i) != null) mediaType = 'image';
        else mediaType = 'video';
    }

    socket.emit('create_post', {
        content, mediaUrl, mediaType,
        authorName: opt.value, authorAvatar: opt.dataset.avatar, authorRole: opt.dataset.role, authorColor: opt.dataset.color,
        ownerId: PLAYER_ID,
        date: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
    });

    document.getElementById('postContent').value = "";
    document.getElementById('postMediaUrl').value = "";
}

function deletePost(e, id) {
    e.stopPropagation();
    if(confirm("Supprimer ce post ?")) socket.emit('delete_post', id);
}

function likePost(e, id) {
    e.stopPropagation();
    socket.emit('like_post', { postId: id, userId: PLAYER_ID });
}

function submitComment() {
    if(!currentPostId) return;
    const sel = document.getElementById('commentCharSelector');
    if(!sel.value) return alert("Perso ?");
    const opt = sel.options[sel.selectedIndex];
    
    const content = document.getElementById('commentInput').value.trim();
    if(!content) return;
    
    socket.emit('post_comment', {
        postId: currentPostId,
        comment: {
            authorName: opt.value, authorAvatar: opt.dataset.avatar, ownerId: PLAYER_ID,
            content: content,
            date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
        }
    });
    document.getElementById('commentInput').value = "";
}

function deleteComment(postId, comId) {
    if(confirm("Supprimer commentaire ?")) socket.emit('delete_comment', { postId, commentId: comId });
}
