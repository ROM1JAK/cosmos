var socket = io();
let myCharacters = [];
let allRooms = []; 
let currentRoomId = 'global'; 
let PLAYER_ID; 
let USERNAME;
let IS_ADMIN = false;

// --- ETAT APPLICATION ---
let currentView = 'ROOM'; // 'ROOM' ou 'DM'
let currentDmUser = null; // Pseudo de la personne avec qui on parle
let totalUnread = 0;

// --- LOGIN ---
function checkAutoLogin() {
    const savedUser = localStorage.getItem('rp_username');
    const savedCode = localStorage.getItem('rp_code');
    if (savedUser && savedCode) socket.emit('login_request', { username: savedUser, code: savedCode });
    else openLoginModal();
}

function openLoginModal() { document.getElementById('login-modal').classList.remove('hidden'); }
function submitLogin() {
    const pseudo = document.getElementById('loginPseudoInput').value.trim();
    const code = document.getElementById('loginCodeInput').value.trim();
    if (pseudo && code) socket.emit('login_request', { username: pseudo, code: code });
}
function logoutUser() {
    localStorage.removeItem('rp_username');
    localStorage.removeItem('rp_code');
    location.reload();
}

socket.on('login_success', (data) => {
    localStorage.setItem('rp_username', data.username);
    localStorage.setItem('rp_code', data.userId);
    USERNAME = data.username;
    PLAYER_ID = data.userId;
    IS_ADMIN = data.isAdmin;
    
    // UI Update
    document.getElementById('player-id-display').textContent = USERNAME;
    document.getElementById('login-modal').classList.add('hidden');
    
    // Initial Data
    socket.emit('request_initial_data', PLAYER_ID);
    joinRoom('global');

    // Mettre à jour badge initial
    totalUnread = data.unreadCount || 0;
    updateBadge();
});

socket.on('login_error', (msg) => { document.getElementById('login-error-msg').textContent = msg; });

// --- NAVIGATION VUES ---
function openInbox() {
    currentView = 'DM';
    document.getElementById('view-room').classList.add('hidden');
    document.getElementById('view-inbox').classList.remove('hidden');
    
    // Charger la liste des conversations
    socket.emit('get_conversations', USERNAME);
}

function openRoomView() {
    currentView = 'ROOM';
    document.getElementById('view-inbox').classList.add('hidden');
    document.getElementById('view-room').classList.remove('hidden');
    currentDmUser = null; // On quitte la conv active
}

// --- MESSAGERIE PRIVÉE (DM) ---
function startDM(targetUser) {
    if(targetUser === USERNAME) return alert("Vous ne pouvez pas vous parler à vous-même.");
    openInbox();
    selectDmUser(targetUser);
}

function selectDmUser(targetUser) {
    currentDmUser = targetUser;
    document.getElementById('dmTargetName').textContent = targetUser;
    document.getElementById('dmInputZone').classList.remove('hidden');
    document.getElementById('dm-messages').innerHTML = '<div style="text-align:center; color:#666; padding:20px;">Chargement...</div>';
    
    // Demander historique
    socket.emit('get_dm_history', { myUsername: USERNAME, otherUsername: targetUser });
    
    // Marquer comme lu visuellement et serveur
    socket.emit('mark_dm_read', { myUsername: USERNAME, senderUsername: targetUser });
    
    // Rafraichir liste pour enlever le gras/notification de cette conv
    socket.emit('get_conversations', USERNAME);
}

function sendDM() {
    const input = document.getElementById('dmInput');
    const content = input.value.trim();
    if(!content || !currentDmUser) return;
    
    socket.emit('send_dm', {
        senderUsername: USERNAME,
        targetUsername: currentDmUser,
        content: content
    });
    input.value = "";
}

// Réception liste conversations
socket.on('conversations_list', (convs) => {
    const list = document.getElementById('dm-list');
    list.innerHTML = "";
    
    let calcUnread = 0;

    convs.forEach(c => {
        calcUnread += c.unread;
        
        const div = document.createElement('div');
        div.className = `dm-item ${c.unread > 0 ? 'unread' : ''} ${currentDmUser === c.with ? 'active' : ''}`;
        div.onclick = () => selectDmUser(c.with);
        
        const time = new Date(c.date).toLocaleDateString();
        div.innerHTML = `
            <div style="display:flex; justify-content:space-between;">
                <span class="dm-username">${c.with}</span>
                <span style="font-size:0.7em; opacity:0.6;">${time}</span>
            </div>
            <div class="dm-last-msg">${c.unread > 0 ? '<strong>' : ''}${c.lastMessage}${c.unread > 0 ? '</strong>' : ''}</div>
        `;
        list.appendChild(div);
    });

    totalUnread = calcUnread;
    updateBadge();
});

// Réception Historique DM
socket.on('dm_history_data', (msgs) => {
    const container = document.getElementById('dm-messages');
    container.innerHTML = "";
    msgs.forEach(displayDmMessage);
    container.scrollTop = container.scrollHeight;
});

// Réception d'un nouveau MP (Temps réel)
socket.on('receive_dm', (msg) => {
    // Si je suis en train de parler avec cette personne
    if (currentView === 'DM' && currentDmUser === msg.senderUsername) {
        displayDmMessage(msg);
        document.getElementById('dm-messages').scrollTop = document.getElementById('dm-messages').scrollHeight;
        // Marquer lu immédiatement
        socket.emit('mark_dm_read', { myUsername: USERNAME, senderUsername: msg.senderUsername });
    } else {
        // Sinon Notification
        totalUnread++;
        updateBadge();
        // Si je suis dans l'inbox mais pas sur cette conv, refresh la liste
        if(currentView === 'DM') socket.emit('get_conversations', USERNAME);
        
        // Petit effet sonore ou visuel optionnel ici
    }
});

// Confirmation d'envoi (pour m'afficher mon propre message)
socket.on('dm_sent_confirmation', (msg) => {
    if (currentView === 'DM' && currentDmUser === msg.targetUsername) {
        displayDmMessage(msg);
        document.getElementById('dm-messages').scrollTop = document.getElementById('dm-messages').scrollHeight;
        socket.emit('get_conversations', USERNAME); // Update la liste pour mettre en haut
    }
});

function displayDmMessage(msg) {
    const container = document.getElementById('dm-messages');
    const isMe = msg.senderUsername === USERNAME;
    const div = document.createElement('div');
    div.className = `dm-bubble ${isMe ? 'me' : 'other'}`;
    div.innerHTML = `
        <div>${msg.content}</div>
        <span class="dm-time">${new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
    `;
    container.appendChild(div);
}

function updateBadge() {
    const badge = document.getElementById('global-badge');
    badge.textContent = totalUnread;
    if(totalUnread > 0) badge.classList.remove('hidden');
    else badge.classList.add('hidden');
}

// --- SALONS RP ---
function joinRoom(roomId) {
    if (currentRoomId && currentRoomId !== roomId) socket.emit('leave_room', currentRoomId);
    currentRoomId = roomId;
    socket.emit('join_room', currentRoomId);
    
    openRoomView(); // Force l'affichage du salon
    
    // Update UI List
    const roomItems = document.querySelectorAll('.room-item');
    roomItems.forEach(el => el.classList.remove('active'));
    // Note: on simplifie ici, la liste est reconstruite par rooms_data
    
    const room = allRooms.find(r => r._id === roomId);
    document.getElementById('currentRoomName').textContent = room ? room.name : 'Salon Global';
    document.getElementById('messages').innerHTML = ""; 
    socket.emit('request_history', currentRoomId);
}

socket.on('rooms_data', (rooms) => { 
    allRooms = rooms; 
    const list = document.getElementById('roomList');
    list.innerHTML = `<div class="room-item ${currentRoomId==='global'?'active':''}" onclick="joinRoom('global')"><span class="room-name">Salon Global</span></div>`;
    rooms.forEach(r => {
        list.innerHTML += `<div class="room-item ${currentRoomId===r._id?'active':''}" onclick="joinRoom('${r._id}')"><span class="room-name">${r.name}</span></div>`;
    });
});

socket.on('message_rp', (msg) => {
    if(msg.roomId === currentRoomId) {
        const div = document.createElement('div');
        div.className = 'message-container';
        div.innerHTML = `
            <img src="${msg.senderAvatar}" class="avatar-img">
            <div class="char-name" style="color:${msg.senderColor}">${msg.senderName}</div>
            <div class="text-body">${msg.content}</div>
        `;
        document.getElementById('messages').appendChild(div);
        document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
    }
});

// --- PERSONNAGES & USER LIST ---
socket.on('update_user_list', (users) => {
    const list = document.getElementById('online-users-list');
    list.innerHTML = "";
    document.getElementById('online-count').textContent = users.length;
    users.forEach(u => {
        // Ajout du bouton DM à côté du pseudo
        const isMe = u === USERNAME;
        const btnDm = isMe ? '' : `<button class="btn-dm-start" onclick="startDM('${u}')" title="Message Privé">✉️</button>`;
        
        list.innerHTML += `
            <div class="user-item-wrapper">
                <div class="online-user">
                    <span class="status-dot"></span><span>${u}</span>
                </div>
                ${btnDm}
            </div>`;
    });
});

socket.on('my_chars_data', (chars) => { 
    myCharacters = chars; 
    const list = document.getElementById('myCharList');
    const select = document.getElementById('charSelector');
    list.innerHTML = ""; select.innerHTML = "";
    
    chars.forEach(c => {
        list.innerHTML += `<div class="char-item"><img src="${c.avatar}" class="mini-avatar"><div class="char-info"><div class="char-name-list" style="color:${c.color}">${c.name}</div></div></div>`;
        const opt = document.createElement('option');
        opt.value = c.name; opt.text = c.name; opt.dataset.color = c.color; opt.dataset.avatar = c.avatar; opt.dataset.role = c.role;
        select.appendChild(opt);
    });
});

// Helpers RP (Typing, Creation...)
function createCharacter() { /* ... Logique existante simplifiée pour l'exemple ... */ }
function sendMessage() {
    const txt = document.getElementById('txtInput');
    const content = txt.value.trim();
    const sel = document.getElementById('charSelector');
    if(!content || !sel.value) return;
    
    const opt = sel.options[sel.selectedIndex];
    socket.emit('message_rp', {
        content, type: "text", roomId: currentRoomId,
        senderName: opt.value, senderColor: opt.dataset.color, senderAvatar: opt.dataset.avatar, senderRole: opt.dataset.role,
        ownerId: PLAYER_ID
    });
    txt.value = "";
}

// Initialisation
socket.on('connect', () => { checkAutoLogin(); });
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function toggleCreateForm() { document.getElementById('create-char-form').classList.toggle('hidden'); }
