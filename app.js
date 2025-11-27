var socket = io();
let myCharacters = [];
let allRooms = []; 
let currentRoomId = 'global'; 
let currentMode = 'ROOM'; // 'ROOM' ou 'DM'
let currentDmUser = null; // Username du destinataire MP
let PLAYER_ID; 
let USERNAME;
let AVATAR;

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

// --- GESTION NAVIGATION (SALON vs MP) ---

// 1. Mode Salon
function joinRoom(roomId) {
    currentMode = 'ROOM';
    currentDmUser = null;
    currentRoomId = roomId;
    
    // UI Update
    document.getElementById('charSelector').classList.remove('hidden'); // On peut choisir un perso en RP
    document.getElementById('header-icon').textContent = "#";
    document.getElementById('chars-section').classList.remove('hidden');
    
    // Socket
    socket.emit('join_room', roomId);
    socket.emit('request_history', roomId); // Récupère historique RP
    
    // Visuel Sidebar
    document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.dm-item').forEach(el => el.classList.remove('active'));
    const activeRoom = document.getElementById(`room-${roomId}`);
    if(activeRoom) activeRoom.classList.add('active');
    
    const room = allRooms.find(r => r._id === roomId);
    document.getElementById('currentContextName').textContent = room ? room.name : "Salon";
    document.getElementById('currentContextDesc').textContent = "Salon RP Public";
    document.getElementById('messages').innerHTML = ""; // Clear
}

// 2. Mode MP
function openDM(targetUsername) {
    if(targetUsername === USERNAME) return;
    currentMode = 'DM';
    currentDmUser = targetUsername;
    
    // UI Update
    document.getElementById('charSelector').classList.add('hidden'); // Pas de perso en HRP/MP
    document.getElementById('header-icon').textContent = "@";
    
    // Header
    document.getElementById('currentContextName').textContent = targetUsername;
    document.getElementById('currentContextDesc').textContent = "Message Privé";
    
    // Visuel Sidebar
    document.querySelectorAll('.room-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.dm-item').forEach(el => el.classList.remove('active'));
    const activeDm = document.getElementById(`dm-${targetUsername}`);
    if(activeDm) {
        activeDm.classList.add('active');
        activeDm.querySelector('.dm-badge')?.remove(); // Enlever badge lu
    }

    document.getElementById('messages').innerHTML = ""; // Clear
    socket.emit('join_dm', { myUsername: USERNAME, targetUsername: targetUsername });
}

// --- AFFICHAGE MESSAGES ---
// Messages RP (Salon)
socket.on('history_data', (msgs) => {
    if(currentMode !== 'ROOM') return;
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
        <div class="msg-header">
            <span class="char-name" style="color:${msg.senderColor}">${msg.senderName}</span>
            <span class="timestamp">${new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
        </div>
        <div class="text-body">${formatText(msg.content)}</div>
    `;
    document.getElementById('messages').appendChild(div);
}

// Messages MP (Direct)
socket.on('dm_history', (data) => {
    if(currentMode !== 'DM' || currentDmUser !== data.target) return;
    const container = document.getElementById('messages');
    container.innerHTML = "";
    data.history.forEach(displayMessageDM);
    container.scrollTop = container.scrollHeight;
});

socket.on('receive_dm', (msg) => {
    // Si on est dans la conv
    if(currentMode === 'DM' && (msg.from === currentDmUser || msg.to === currentDmUser)) {
        displayMessageDM(msg);
        document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
    } 
    // Toujours rafraichir la liste à gauche pour voir le badge ou remonter la conv
    socket.emit('request_dm_list', USERNAME);
});

socket.on('refresh_dm_list_trigger', () => {
    socket.emit('request_dm_list', USERNAME);
});

function displayMessageDM(msg) {
    // Dans les MP, on utilise l'avatar de l'USER, pas du perso
    const isMe = msg.from === USERNAME;
    const div = document.createElement('div');
    div.className = 'message-container';
    
    // Si c'est moi, j'utilise mon avatar stocké, sinon celui reçu (ou placeholder)
    const avatar = isMe ? AVATAR : (msg.avatar || `https://ui-avatars.com/api/?name=${msg.from}`);
    
    div.innerHTML = `
        <img src="${avatar}" class="avatar-img">
        <div class="msg-header">
            <span class="char-name" style="color: ${isMe ? '#fff' : '#ccc'}">${msg.from}</span>
            <span class="timestamp">${new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
        </div>
        <div class="text-body">${formatText(msg.content)}</div>
    `;
    document.getElementById('messages').appendChild(div);
}

// --- SIDEBARS ---
// 1. Liste Salons
socket.on('rooms_data', (rooms) => { 
    allRooms = rooms; 
    const list = document.getElementById('roomList');
    list.innerHTML = `<div id="room-global" class="room-item ${currentRoomId==='global'?'active':''}" onclick="joinRoom('global')"><span class="room-name">Salon Global</span></div>`;
    rooms.forEach(r => {
        list.innerHTML += `<div id="room-${r._id}" class="room-item ${currentRoomId===r._id?'active':''}" onclick="joinRoom('${r._id}')"><span class="room-name">${r.name}</span></div>`;
    });
});

// 2. Liste MP
socket.on('dm_list_data', (contacts) => {
    const list = document.getElementById('dmList');
    list.innerHTML = "";
    contacts.forEach(c => {
        const isActive = (currentMode === 'DM' && currentDmUser === c.username);
        const badge = c.unreadCount > 0 ? `<span class="dm-badge">${c.unreadCount}</span>` : '';
        
        const div = document.createElement('div');
        div.className = `dm-item ${isActive ? 'active' : ''}`;
        div.id = `dm-${c.username}`;
        div.onclick = () => openDM(c.username);
        div.innerHTML = `
            <img src="${c.avatar}" class="dm-avatar">
            <div class="dm-name">${c.username}</div>
            ${badge}
        `;
        list.appendChild(div);
    });
});

// 3. Liste Users (Droite)
socket.on('update_user_list', (users) => {
    const list = document.getElementById('online-users-list');
    list.innerHTML = "";
    document.getElementById('online-count').textContent = users.length;
    users.forEach(u => {
        if(u === USERNAME) return; // Ne pas s'afficher soi-même
        list.innerHTML += `
            <div class="online-user" onclick="openDM('${u}')">
                <span class="status-dot"></span>
                <span>${u}</span>
            </div>`;
    });
});

// --- ENVOI MESSAGE ---
function sendMessage() {
    const txt = document.getElementById('txtInput');
    const content = txt.value.trim();
    if(!content) return;

    if(currentMode === 'ROOM') {
        // Envoi RP
        const sel = document.getElementById('charSelector');
        if(sel.options.length === 0) return alert("Créez un perso !");
        const opt = sel.options[sel.selectedIndex];
        socket.emit('message_rp', {
            content, type: "text", roomId: currentRoomId,
            senderName: opt.value, senderColor: opt.dataset.color, senderAvatar: opt.dataset.avatar, senderRole: opt.dataset.role,
            ownerId: PLAYER_ID
        });
    } else {
        // Envoi MP
        socket.emit('send_dm', {
            from: USERNAME,
            to: currentDmUser,
            content: content
        });
    }
    txt.value = "";
}

// --- UTILS ---
function createRoomPrompt() { const n = prompt("Nom ?"); if(n) socket.emit('create_room', {name: n, creatorId: PLAYER_ID, allowedCharacters: []}); }
function formatText(text) { return text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\*(.*?)\*/g, '<i>$1</i>'); }
socket.on('my_chars_data', (chars) => { 
    myCharacters = chars;
    const list = document.getElementById('myCharList');
    const sel = document.getElementById('charSelector');
    list.innerHTML = ""; sel.innerHTML = "";
    chars.forEach(c => {
        list.innerHTML += `<div class="room-item"><span style="color:${c.color}">${c.name}</span></div>`;
        const opt = document.createElement('option');
        opt.value = c.name; opt.text = c.name; opt.dataset.color = c.color; opt.dataset.avatar = c.avatar; opt.dataset.role = c.role;
        sel.appendChild(opt);
    });
});
function createCharacter() { /* ... Logique form ... */ 
    const name = document.getElementById('newCharName').value;
    const role = document.getElementById('newCharRole').value;
    // ... Simplified
    socket.emit('create_char', { name, role, color: document.getElementById('newCharColor').value, avatar: document.getElementById('newCharBase64').value || `https://ui-avatars.com/api/?name=${name}`, description: "", ownerId: PLAYER_ID });
    toggleCreateForm();
}
function previewFile(t) { const f = document.getElementById(t==='new'?'newCharFile':'editCharFile').files[0]; const r = new FileReader(); r.onload=e=>document.getElementById(t==='new'?'newCharBase64':'editCharBase64').value=e.target.result; if(f)r.readAsDataURL(f); }
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function toggleCreateForm() { document.getElementById('create-char-form').classList.toggle('hidden'); }
socket.on('connect', checkAutoLogin);
document.getElementById('txtInput').addEventListener('keyup', (e) => { if(e.key === 'Enter') sendMessage(); });
