var socket = io();
let myCharacters = [];
let allRooms = []; 
let currentRoomId = 'global'; 
let currentMode = 'ROOM'; // 'ROOM' ou 'DM'
let currentDmUser = null; 
let PLAYER_ID; 
let USERNAME;
let AVATAR;
let IS_ADMIN = false;
let currentContext = null;
let typingTimeout = null;

// --- LOGIN ---
function checkAutoLogin() {
    const savedUser = localStorage.getItem('rp_username');
    const savedCode = localStorage.getItem('rp_code');
    if (savedUser && savedCode) socket.emit('login_request', { username: savedUser, code: savedCode });
    else openLoginModal();
}
function openLoginModal() { document.getElementById('login-modal').classList.remove('hidden'); }
function closeLoginModal() { document.getElementById('login-modal').classList.add('hidden'); }
function submitLogin() {
    const pseudo = document.getElementById('loginPseudoInput').value.trim();
    const code = document.getElementById('loginCodeInput').value.trim();
    if(pseudo && code) socket.emit('login_request', { username: pseudo, code: code });
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
    AVATAR = data.avatar;
    document.getElementById('player-id-display').textContent = USERNAME;
    closeLoginModal();
    
    // Init
    socket.emit('request_initial_data', PLAYER_ID);
    socket.emit('request_dm_list', USERNAME);
    joinRoom('global');
});
socket.on('login_error', (msg) => { document.getElementById('login-error-msg').textContent = msg; });

// --- NAVIGATION (ROOM vs DM) ---

// 1. SALON
function joinRoom(roomId) {
    currentMode = 'ROOM';
    currentDmUser = null;
    currentRoomId = roomId;
    
    // UI
    document.getElementById('charSelector').classList.remove('hidden');
    document.getElementById('headerIcon').textContent = "#";
    document.getElementById('currentRoomName').textContent = "Chargement...";
    document.getElementById('headerDesc').textContent = "Salon RP";
    document.getElementById('chars-section').classList.remove('hidden');
    
    // Sockets
    socket.emit('join_room', roomId);
    socket.emit('request_history', roomId);
    
    // Visuel Sidebar
    updateActiveSidebar();
}

// 2. MP (DM)
function openDM(targetUser) {
    if(targetUser === USERNAME) return;
    currentMode = 'DM';
    currentDmUser = targetUser;
    
    // UI
    document.getElementById('charSelector').classList.add('hidden'); // Pas de perso en MP
    document.getElementById('headerIcon').textContent = "@";
    document.getElementById('currentRoomName').textContent = targetUser;
    document.getElementById('headerDesc').textContent = "Message Privé";
    
    // Clear & Load
    document.getElementById('messages').innerHTML = "";
    socket.emit('join_dm', { myUsername: USERNAME, targetUsername: targetUser });
    
    updateActiveSidebar();
}

function updateActiveSidebar() {
    // Rooms
    document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
    if(currentMode === 'ROOM') {
        const el = document.getElementById(`room-${currentRoomId}`);
        if(el) el.classList.add('active');
    }
    
    // DMs
    document.querySelectorAll('.dm-item').forEach(el => el.classList.remove('active'));
    if(currentMode === 'DM') {
        const el = document.getElementById(`dm-${currentDmUser}`);
        if(el) el.classList.add('active');
        // Remove badge localement
        if(el) { const b = el.querySelector('.dm-badge'); if(b) b.remove(); }
    }
}

// --- AFFICHAGE MESSAGES ---

// 1. RP History
socket.on('history_data', (msgs) => {
    if(currentMode !== 'ROOM') return;
    const room = allRooms.find(r => r._id === currentRoomId);
    document.getElementById('currentRoomName').textContent = room ? room.name : "Salon";
    const container = document.getElementById('messages');
    container.innerHTML = "";
    msgs.forEach(displayMessageRP);
    container.scrollTop = container.scrollHeight;
});

socket.on('message_rp', (msg) => {
    if(currentMode === 'ROOM' && msg.roomId === currentRoomId) {
        displayMessageRP(msg);
        document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
    }
});

function displayMessageRP(msg) {
    const div = document.createElement('div');
    div.className = 'message-container';
    div.innerHTML = `
        <img src="${msg.senderAvatar}" class="avatar-img">
        <div class="char-header">
            <span class="char-name" style="color:${msg.senderColor}">${msg.senderName}</span>
            <span class="char-role">${msg.senderRole}</span>
            <span class="timestamp">${new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
        </div>
        <div class="text-body">${formatText(msg.content)}</div>
    `;
    document.getElementById('messages').appendChild(div);
}

// 2. DM History
socket.on('dm_history_data', (data) => {
    if(currentMode !== 'DM' || currentDmUser !== data.target) return;
    const container = document.getElementById('messages');
    container.innerHTML = "";
    data.history.forEach(displayMessageDM);
    container.scrollTop = container.scrollHeight;
});

socket.on('receive_dm', (msg) => {
    // Si conv active
    if(currentMode === 'DM' && (msg.from === currentDmUser || msg.to === currentDmUser)) {
        displayMessageDM(msg);
        document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
    }
    // Update liste gauche (remonte la conv ou ajoute)
    socket.emit('request_dm_list', USERNAME);
});

socket.on('refresh_dm_list', () => {
    socket.emit('request_dm_list', USERNAME);
});

function displayMessageDM(msg) {
    const isMe = msg.from === USERNAME;
    const avatar = isMe ? AVATAR : (msg.avatar || `https://ui-avatars.com/api/?name=${msg.from}`);
    const div = document.createElement('div');
    div.className = 'message-container';
    div.innerHTML = `
        <img src="${avatar}" class="avatar-img">
        <div class="char-header">
            <span class="char-name" style="color:${isMe ? '#fff' : '#ccc'}">${msg.from}</span>
            <span class="timestamp">${new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
        </div>
        <div class="text-body">${formatText(msg.content)}</div>
    `;
    document.getElementById('messages').appendChild(div);
}

// --- SIDEBAR DATA ---
socket.on('rooms_data', (rooms) => { 
    allRooms = rooms; 
    const list = document.getElementById('roomList');
    list.innerHTML = `<div id="room-global" class="room-item ${currentRoomId==='global'?'active':''}" onclick="joinRoom('global')"><span class="room-name">Salon Global</span></div>`;
    rooms.forEach(r => {
        list.innerHTML += `<div id="room-${r._id}" class="room-item ${currentRoomId===r._id?'active':''}" onclick="joinRoom('${r._id}')"><span class="room-name">${r.name}</span></div>`;
    });
});

socket.on('dm_list_data', (contacts) => {
    const list = document.getElementById('dmList');
    list.innerHTML = "";
    contacts.forEach(c => {
        const isActive = (currentMode === 'DM' && currentDmUser === c.username);
        const badge = c.unreadCount > 0 ? `<span class="dm-badge">${c.unreadCount}</span>` : '';
        const div = document.createElement('div');
        div.className = `dm-item ${isActive ? 'active' : ''} ${c.unreadCount > 0 ? 'unread' : ''}`;
        div.id = `dm-${c.username}`;
        div.onclick = () => openDM(c.username);
        div.innerHTML = `
            <img src="${c.avatar}" class="dm-avatar">
            <span>${c.username}</span>
            ${badge}
        `;
        list.appendChild(div);
    });
});

socket.on('update_user_list', (users) => {
    const list = document.getElementById('online-users-list');
    list.innerHTML = "";
    document.getElementById('online-count').textContent = users.length;
    users.forEach(u => {
        if(u === USERNAME) return;
        list.innerHTML += `<div class="online-user" onclick="openDM('${u}')"><span class="status-dot"></span><span>${u}</span></div>`;
    });
});

// --- ENVOI ---
function sendMessage() {
    const txt = document.getElementById('txtInput');
    const content = txt.value.trim();
    if(!content) return;

    if(currentMode === 'ROOM') {
        const sel = document.getElementById('charSelector');
        if(sel.options.length === 0) return alert("Créez un personnage !");
        const opt = sel.options[sel.selectedIndex];
        socket.emit('message_rp', {
            content, type: "text", roomId: currentRoomId,
            senderName: opt.value, senderColor: opt.dataset.color, senderAvatar: opt.dataset.avatar, senderRole: opt.dataset.role,
            ownerId: PLAYER_ID
        });
    } else {
        // Envoi MP
        socket.emit('send_dm', { from: USERNAME, to: currentDmUser, content: content });
    }
    txt.value = "";
}

// --- UTILS (Format, Persos...) ---
function formatText(text) { return text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\*(.*?)\*/g, '<i>$1</i>'); }
function createRoomPrompt() { const n = prompt("Nom ?"); if(n) socket.emit('create_room', {name: n, creatorId: PLAYER_ID, allowedCharacters: []}); }

socket.on('my_chars_data', (chars) => { 
    myCharacters = chars;
    const list = document.getElementById('myCharList');
    const sel = document.getElementById('charSelector');
    list.innerHTML = ""; sel.innerHTML = "";
    chars.forEach(c => {
        list.innerHTML += `<div class="char-item"><img src="${c.avatar}" class="mini-avatar"><div class="char-info"><div class="char-name-list" style="color:${c.color}">${c.name}</div></div></div>`;
        const opt = document.createElement('option');
        opt.value = c.name; opt.text = c.name; opt.dataset.color = c.color; opt.dataset.avatar = c.avatar; opt.dataset.role = c.role;
        sel.appendChild(opt);
    });
});

// Fonctions Forms
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function toggleCreateForm() { document.getElementById('create-char-form').classList.toggle('hidden'); }
function previewFile(t) { const f = document.getElementById(t==='new'?'newCharFile':'editCharFile').files[0]; const r = new FileReader(); r.onload=e=>document.getElementById(t==='new'?'newCharBase64':'editCharBase64').value=e.target.result; if(f)r.readAsDataURL(f); }
function createCharacter() {
    const name = document.getElementById('newCharName').value;
    const role = document.getElementById('newCharRole').value;
    const avatar = document.getElementById('newCharBase64').value || `https://ui-avatars.com/api/?name=${name}`;
    socket.emit('create_char', { name, role, avatar, color: document.getElementById('newCharColor').value, description: document.getElementById('newCharDesc').value, ownerId: PLAYER_ID });
    toggleCreateForm();
}

// Init
socket.on('connect', checkAutoLogin);
document.getElementById('txtInput').addEventListener('keyup', (e) => { if(e.key === 'Enter') sendMessage(); });
