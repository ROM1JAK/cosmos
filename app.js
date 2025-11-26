var socket = io();
let myCharacters = [];
let allRooms = []; 
let currentRoomId = 'global'; 
let PLAYER_ID; 
let currentReply = null; 

// --- 1. UI & LOGIN ---
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function toggleCreateForm() { document.getElementById('create-char-form').classList.toggle('hidden'); }

function getPlayerId() {
    let id = localStorage.getItem('rp_player_id');
    if (!id) { id = 'player_' + Math.random().toString(36).substring(2, 9); localStorage.setItem('rp_player_id', id); }
    PLAYER_ID = id;
    const display = document.getElementById('player-id-display');
    display.textContent = id.startsWith('player_') ? 'Compte : Invité' : `Compte : ${id}`;
    return id;
}
function loginUser() {
    const newId = prompt("Identifiant secret :");
    if (newId && newId.trim()) { localStorage.setItem('rp_player_id', newId.trim()); location.reload(); }
}
getPlayerId();

// --- 2. SOCKET ---
socket.on('connect', () => {
    socket.emit('request_my_chars', PLAYER_ID);
    socket.emit('request_rooms');
    joinRoom('global');
});

// --- 3. SALONS ---
function createRoomPrompt() {
    const name = prompt("Nom du salon :");
    if (name) socket.emit('create_room', { name, creatorId: PLAYER_ID, allowedCharacters: [] });
}
function joinRoom(roomId) {
    if (currentRoomId && currentRoomId !== roomId) socket.emit('leave_room', currentRoomId);
    currentRoomId = roomId;
    socket.emit('join_room', currentRoomId);
    
    const room = allRooms.find(r => r._id === roomId);
    document.getElementById('currentRoomName').textContent = room ? room.name : 'Salon Global';
    document.getElementById('messages').innerHTML = ""; 
    socket.emit('request_history', currentRoomId);
    cancelReply();
    if(window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
    updateRoomListUI();
}
socket.on('rooms_data', (rooms) => { allRooms = rooms; updateRoomListUI(); });

function updateRoomListUI() {
    const list = document.getElementById('roomList');
    list.innerHTML = `<div class="room-item ${currentRoomId === 'global'?'active':''}" onclick="joinRoom('global')">Salon Global</div>`;
    allRooms.forEach(room => { list.innerHTML += `<div class="room-item ${currentRoomId === room._id?'active':''}" onclick="joinRoom('${room._id}')">${room.name}</div>`; });
}

// --- 4. PERSONNAGES ---
function createCharacter() {
    const name = document.getElementById('newCharName').value.trim();
    const role = document.getElementById('newCharRole').value.trim();
    const color = document.getElementById('newCharColor').value;
    let avatar = document.getElementById('newCharAvatar').value.trim();
    if(!name || !role) return alert("Nom et Rôle requis");
    if(!avatar) avatar = `https://ui-avatars.com/api/?name=${name}&background=random`;
    
    socket.emit('create_char', { name, role, color, avatar, ownerId: PLAYER_ID });
    toggleCreateForm();
}
socket.on('my_chars_data', (chars) => { myCharacters = chars; updateUI(); });
socket.on('char_created_success', (char) => { myCharacters.push(char); updateUI(); });
function deleteCharacter(name) { if(confirm('Supprimer ?')) socket.emit('delete_char', name); }
socket.on('char_deleted_success', (name) => { myCharacters = myCharacters.filter(c => c.name !== name); updateUI(); });

function updateUI() {
    const list = document.getElementById('myCharList');
    const select = document.getElementById('charSelector');
    const prev = select.value;
    
    list.innerHTML = "";
    select.innerHTML = '<option value="Narrateur" data-color="#ffffff" data-avatar="https://cdn-icons-png.flaticon.com/512/1144/1144760.png" data-role="Omniscient">Narrateur</option>';
    
    myCharacters.forEach(char => {
        list.innerHTML += `
            <div class="char-item">
                <img src="${char.avatar}" class="mini-avatar">
                <div class="char-info">
                    <div class="char-name-list" style="color:${char.color}">${char.name}</div>
                    <div class="char-role-list">${char.role}</div>
                </div>
                <button class="btn-delete" onclick="deleteCharacter('${char.name}')">×</button>
            </div>`;
        const opt = document.createElement('option');
        opt.value = char.name; opt.text = char.name; 
        opt.dataset.color = char.color; opt.dataset.avatar = char.avatar; opt.dataset.role = char.role;
        select.appendChild(opt);
    });
    if (prev && (prev === "Narrateur" || myCharacters.some(c => c.name === prev))) select.value = prev;
}

// --- 5. CHAT, MP & RÉPONSES ---

// Déclencher une réponse
function triggerReply(id, author, content) {
    currentReply = { id, author, content };
    document.getElementById('reply-bar').style.display = 'flex';
    document.getElementById('reply-target-name').textContent = author;
    document.getElementById('txtInput').focus();
}
function cancelReply() {
    currentReply = null;
    document.getElementById('reply-bar').style.display = 'none';
}

// Déclencher un MP
function triggerDM(name) {
    document.getElementById('targetInput').value = name;
    document.getElementById('txtInput').focus();
}

function sendMessage() {
    const txt = document.getElementById('txtInput');
    const content = txt.value.trim();
    if (!content) return;
    sendPayload(content, "text");
    txt.value = '';
    cancelReply();
}

function askForImage() {
    const url = prompt("URL de l'image :");
    if(url) sendPayload(url, "image");
}

function sendPayload(content, type) {
    const sel = document.getElementById('charSelector');
    const opt = sel.options[sel.selectedIndex];
    const target = document.getElementById('targetInput').value.trim();
    
    const msg = {
        content, type,
        senderName: opt.value,
        senderColor: opt.dataset.color || "#fff",
        senderAvatar: opt.dataset.avatar,
        senderRole: opt.dataset.role,
        targetName: target,
        roomId: currentRoomId,
        date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
        replyTo: currentReply
    };
    socket.emit('message_rp', msg);
}

socket.on('history_data', (msgs) => {
    document.getElementById('messages').innerHTML = "";
    msgs.forEach(displayMessage);
    scrollToBottom();
});
socket.on('message_rp', (msg) => {
    if(msg.roomId === currentRoomId) { displayMessage(msg); scrollToBottom(); }
});

function displayMessage(msg) {
    const div = document.createElement('div');
    const isPrivate = msg.targetName && msg.targetName !== "";
    div.className = 'message-container';

    // HTML de la réponse (Ligne courbée + mini contexte)
    let replyHTML = "";
    if (msg.replyTo && msg.replyTo.author) {
        replyHTML = `
            <div class="reply-spine"></div>
            <div class="reply-context-line" style="margin-left: 55px;">
                <img src="https://ui-avatars.com/api/?name=${msg.replyTo.author}&background=random" class="reply-avatar-mini">
                <span class="reply-name">@${msg.replyTo.author}</span>
                <span class="reply-text">${msg.replyTo.content}</span>
            </div>
        `;
    }

    // Contenu
    let contentHTML = msg.type === "image" 
        ? `<img src="${msg.content}" class="chat-image" onclick="window.open(this.src)">` 
        : `<div class="text-body">${msg.content}</div>`;

    const safeAuthor = msg.senderName.replace(/'/g, "\\'");
    const safeContent = msg.content.replace(/'/g, "\\'");

    // Si c'est une réponse, on ajoute de la marge en haut pour la ligne courbée
    const spacingStyle = msg.replyTo ? 'margin-top: 5px;' : '';

    div.innerHTML = `
        ${replyHTML}
        
        <div class="msg-actions">
            <button class="action-btn" onclick="triggerReply('${msg._id}', '${safeAuthor}', '${safeContent}')">↩️</button>
            <button class="action-btn" onclick="triggerDM('${safeAuthor}')">✉️</button>
        </div>

        <div style="position:relative; ${spacingStyle} ${isPrivate ? 'background:rgba(218, 55, 60, 0.1); border-radius:4px;' : ''}">
            <img src="${msg.senderAvatar}" class="avatar-img">
            <div style="margin-left: 55px;">
                <div class="char-header">
                    <span class="char-name" style="color: ${msg.senderColor}">${msg.senderName}</span>
                    <span class="char-role">${msg.senderRole || ""}</span>
                    <span class="timestamp">${msg.date}</span>
                    ${isPrivate ? '<span class="private-badge">🔒 Privé</span>' : ''}
                </div>
                ${contentHTML}
            </div>
        </div>
    `;
    document.getElementById('messages').appendChild(div);
}

function scrollToBottom() { const d = document.getElementById('messages'); d.scrollTop = d.scrollHeight; }
document.getElementById('txtInput').addEventListener('keyup', (e) => { if(e.key === 'Enter') sendMessage(); });
