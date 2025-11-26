var socket = io();
let myCharacters = [];
let allRooms = []; 
let currentRoomId = 'global'; 
let USER_NAME = ""; 
let USER_CODE = "";
let IS_ADMIN = false;
let currentContext = null; 
let typingTimeout = null;

// --- UI & LOGIN ---
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('mobile-overlay').classList.toggle('open'); }
function toggleCreateForm() { document.getElementById('create-char-form').classList.toggle('hidden'); }

function openLoginModal() { document.getElementById('login-modal').classList.remove('hidden'); }
function closeLoginModal() { document.getElementById('login-modal').classList.add('hidden'); }

function submitLogin() {
    const pseudo = document.getElementById('loginPseudoInput').value.trim();
    const code = document.getElementById('loginCodeInput').value.trim();
    if (pseudo && code) {
        socket.emit('login_request', { username: pseudo, code: code });
    }
}

// Réception de la connexion réussie
socket.on('login_success', (data) => {
    USER_NAME = data.username;
    USER_CODE = data.userId;
    IS_ADMIN = data.isAdmin;
    
    // Sauvegarde
    localStorage.setItem('rp_username', USER_NAME);
    localStorage.setItem('rp_code', USER_CODE);
    
    document.getElementById('player-id-display').textContent = `Compte : ${USER_NAME}`;
    if(IS_ADMIN) document.getElementById('player-id-display').style.color = "#da373c"; // Rouge si admin
    
    closeLoginModal();
    
    // Charger les données après login
    socket.emit('request_initial_data', USER_CODE);
    joinRoom('global');
});

// Auto-login au démarrage
function checkAutoLogin() {
    const savedUser = localStorage.getItem('rp_username');
    const savedCode = localStorage.getItem('rp_code');
    if (savedUser && savedCode) {
        socket.emit('login_request', { username: savedUser, code: savedCode });
    } else {
        openLoginModal();
    }
}
checkAutoLogin();

// --- PROFIL ---
function openProfile(charName) { socket.emit('get_char_profile', charName); }
function closeProfileModal() { document.getElementById('profile-modal').classList.add('hidden'); }
socket.on('char_profile_data', (char) => {
    document.getElementById('profileName').textContent = char.name;
    document.getElementById('profileRole').textContent = char.role;
    document.getElementById('profileAvatar').src = char.avatar;
    document.getElementById('profileDesc').textContent = char.description || "Aucune description.";
    // Affichage du propriétaire
    document.getElementById('profileOwner').textContent = `Joué par : ${char.ownerUsername || "Inconnu"}`;
    document.getElementById('profile-modal').classList.remove('hidden');
});

// --- TYPING & SOCKET EVENTS ---
socket.on('force_history_refresh', (data) => { if (currentRoomId === data.roomId) socket.emit('request_history', currentRoomId); });
socket.on('force_room_exit', (roomId) => { if(currentRoomId === roomId) joinRoom('global'); });
socket.on('history_cleared', () => { document.getElementById('messages').innerHTML = ""; });

const txtInput = document.getElementById('txtInput');
txtInput.addEventListener('input', () => {
    const sel = document.getElementById('charSelector');
    const name = sel.options[sel.selectedIndex]?.text || "Quelqu'un";
    socket.emit('typing_start', { roomId: currentRoomId, charName: name });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { socket.emit('typing_stop', { roomId: currentRoomId, charName: name }); }, 1000);
});
socket.on('display_typing', (data) => {
    if(data.roomId === currentRoomId) { document.getElementById('typing-indicator').classList.remove('hidden'); document.getElementById('typing-text').textContent = `${data.charName} écrit...`; }
});
socket.on('hide_typing', (data) => { if(data.roomId === currentRoomId) document.getElementById('typing-indicator').classList.add('hidden'); });

// --- SALONS ---
function createRoomPrompt() {
    const name = prompt("Nom du salon :");
    if (name) socket.emit('create_room', { name, creatorId: USER_CODE, allowedCharacters: [] });
}
function deleteRoom(roomId) {
    if(confirm("ADMIN : Supprimer ce salon définitivement ?")) socket.emit('delete_room', roomId);
}

function joinRoom(roomId) {
    if (currentRoomId && currentRoomId !== roomId) socket.emit('leave_room', currentRoomId);
    currentRoomId = roomId;
    socket.emit('join_room', currentRoomId);
    const room = allRooms.find(r => r._id === roomId);
    document.getElementById('currentRoomName').textContent = room ? room.name : 'Salon Global';
    document.getElementById('messages').innerHTML = ""; 
    document.getElementById('typing-indicator').classList.add('hidden');
    socket.emit('request_history', currentRoomId);
    cancelContext();
    if(window.innerWidth <= 768) { document.getElementById('sidebar').classList.remove('open'); document.getElementById('mobile-overlay').classList.remove('open'); }
    updateRoomListUI();
}
socket.on('rooms_data', (rooms) => { allRooms = rooms; updateRoomListUI(); });

function updateRoomListUI() {
    const list = document.getElementById('roomList');
    list.innerHTML = `<div class="room-item ${currentRoomId === 'global'?'active':''}" onclick="joinRoom('global')"><span class="room-name">Salon Global</span></div>`;
    allRooms.forEach(room => {
        // Bouton supprimer si admin
        const delBtn = IS_ADMIN ? `<button class="btn-del-room" onclick="event.stopPropagation(); deleteRoom('${room._id}')">✕</button>` : '';
        list.innerHTML += `<div class="room-item ${currentRoomId === room._id?'active':''}" onclick="joinRoom('${room._id}')"><span class="room-name">${room.name}</span>${delBtn}</div>`;
    });
}

// --- PERSONNAGES ---
function createCharacter() {
    const name = document.getElementById('newCharName').value.trim();
    const role = document.getElementById('newCharRole').value.trim();
    const desc = document.getElementById('newCharDesc').value.trim();
    const color = document.getElementById('newCharColor').value;
    let avatar = document.getElementById('newCharAvatar').value.trim();
    if(!name || !role) return alert("Nom et Rôle requis");
    if(!avatar) avatar = `https://ui-avatars.com/api/?name=${name}&background=random`;
    
    // On envoie aussi ownerUsername
    socket.emit('create_char', { name, role, color, avatar, description: desc, ownerId: USER_CODE, ownerUsername: USER_NAME });
    toggleCreateForm();
}

function editCharacter(name, role, avatar, color, desc) {
    document.getElementById('editCharOriginalName').value = name;
    document.getElementById('editCharName').value = name;
    document.getElementById('editCharRole').value = role;
    document.getElementById('editCharAvatar').value = avatar;
    document.getElementById('editCharDesc').value = desc; 
    document.getElementById('editCharColor').value = color;
    document.getElementById('edit-char-form').classList.remove('hidden');
    document.getElementById('create-char-form').classList.add('hidden');
}
function cancelEditCharacter() { document.getElementById('edit-char-form').classList.add('hidden'); }
function submitEditCharacter() {
    const originalName = document.getElementById('editCharOriginalName').value;
    const newName = document.getElementById('editCharName').value.trim();
    const newRole = document.getElementById('editCharRole').value.trim();
    const newAvatar = document.getElementById('editCharAvatar').value.trim();
    const newColor = document.getElementById('editCharColor').value;
    const newDesc = document.getElementById('editCharDesc').value.trim();
    socket.emit('edit_char', { originalName, newName, newRole, newAvatar, newColor, newDescription: newDesc, ownerId: USER_CODE, ownerUsername: USER_NAME, currentRoomId: currentRoomId });
    cancelEditCharacter();
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
        const safeDesc = (char.description || "").replace(/'/g, "\\'");
        list.innerHTML += `
            <div class="char-item"><img src="${char.avatar}" class="mini-avatar"><div class="char-info"><div class="char-name-list" style="color:${char.color}">${char.name}</div><div class="char-role-list">${char.role}</div></div><div class="char-actions"><button class="btn-mini-action" onclick="editCharacter('${char.name}', '${char.role}', '${char.avatar}', '${char.color}', '${safeDesc}')">⚙️</button><button class="btn-mini-action" onclick="deleteCharacter('${char.name}')" style="color:#da373c;">✕</button></div></div>`;
        const opt = document.createElement('option');
        opt.value = char.name; opt.text = char.name; opt.dataset.color = char.color; opt.dataset.avatar = char.avatar; opt.dataset.role = char.role;
        select.appendChild(opt);
    });
    if (prev && (prev === "Narrateur" || myCharacters.some(c => c.name === prev))) select.value = prev;
}

// --- ENVOI MESSAGE & COMMANDES ---
function sendMessage() {
    const txt = document.getElementById('txtInput');
    const content = txt.value.trim();
    if (!content) return;
    
    // Commande Admin /clear
    if (content === "/clear") {
        if(IS_ADMIN) socket.emit('admin_clear_room', currentRoomId);
        else alert("Réservé à l'admin !");
        txt.value = ''; return;
    }

    if (currentContext && currentContext.type === 'edit') {
        socket.emit('edit_message', { id: currentContext.data.id, newContent: content });
        txt.value = ''; cancelContext(); return;
    }

    const sel = document.getElementById('charSelector');
    const opt = sel.options[sel.selectedIndex];
    const msg = {
        content, type: "text",
        senderName: opt.value, senderColor: opt.dataset.color || "#fff", senderAvatar: opt.dataset.avatar, senderRole: opt.dataset.role,
        ownerId: USER_CODE, targetName: "", roomId: currentRoomId,
        date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
        replyTo: (currentContext && currentContext.type === 'reply') ? { id: currentContext.data.id, author: currentContext.data.author, content: currentContext.data.content } : null
    };
    socket.emit('message_rp', msg);
    txt.value = ''; cancelContext();
}

// --- RESTE DES ACTIONS (Reply, Edit, etc.) ---
function setContext(type, data) {
    currentContext = { type, data };
    const bar = document.getElementById('context-bar');
    const icon = document.getElementById('context-icon');
    const text = document.getElementById('context-text');
    bar.className = 'visible';
    document.getElementById('txtInput').focus();
    if (type === 'reply') { icon.textContent = "↩️"; text.innerHTML = `Répondre à <strong>${data.author}</strong>`; }
    else if (type === 'edit') { icon.textContent = "✏️"; text.innerHTML = `Modifier message`; document.getElementById('txtInput').value = data.content; }
}
function cancelContext() {
    currentContext = null; document.getElementById('context-bar').className = 'hidden';
    if(document.getElementById('txtInput').value !== "") document.getElementById('txtInput').value = "";
}
function triggerReply(id, author, content) { setContext('reply', { id, author, content }); }
function triggerEdit(id, content) { setContext('edit', { id, content }); }
function triggerDelete(id) { if(confirm("Supprimer ?")) socket.emit('delete_message', id); }
function askForImage() {
    const url = prompt("URL de l'image :");
    if(url) {
        const sel = document.getElementById('charSelector'); const opt = sel.options[sel.selectedIndex];
        socket.emit('message_rp', { content: url, type: "image", senderName: opt.value, senderColor: opt.dataset.color, senderAvatar: opt.dataset.avatar, senderRole: opt.dataset.role, ownerId: USER_CODE, targetName: "", roomId: currentRoomId, date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), replyTo: null });
    }
}

socket.on('history_data', (msgs) => { document.getElementById('messages').innerHTML = ""; msgs.forEach(displayMessage); scrollToBottom(); });
socket.on('message_rp', (msg) => { if(msg.roomId === currentRoomId) { displayMessage(msg); scrollToBottom(); } });
socket.on('message_deleted', (msgId) => { const el = document.getElementById(`msg-${msgId}`); if(el) el.remove(); });
socket.on('message_updated', (data) => {
    const el = document.getElementById(`content-${data.id}`);
    if(el) { el.innerHTML = formatText(data.newContent); const meta = el.parentElement.parentElement.querySelector('.timestamp'); if(!meta.textContent.includes('(modifié)')) meta.textContent += ' (modifié)'; }
});

function formatText(text) {
    if(!text) return "";
    return text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\*(.*?)\*/g, '<i>$1</i>').replace(/\|\|(.*?)\|\|/g, '<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>');
}

function displayMessage(msg) {
    const div = document.createElement('div');
    div.className = 'message-container';
    div.id = `msg-${msg._id}`;
    
    // DROIT DE SUPPRESSION : SI C'EST MOI OU SI JE SUIS ADMIN
    const canEdit = (msg.ownerId === USER_CODE);
    const canDelete = (msg.ownerId === USER_CODE) || IS_ADMIN;

    let actionsHTML = `<button class="action-btn" onclick="triggerReply('${msg._id}', '${msg.senderName.replace(/'/g, "\\'")}', '${msg.content.replace(/'/g, "\\'")}')" title="Répondre">↩️</button>`;
    
    if (msg.type === 'text') {
        if (canEdit) actionsHTML += `<button class="action-btn" onclick="triggerEdit('${msg._id}', '${msg.content.replace(/'/g, "\\'")}')" title="Modifier">✏️</button>`;
        if (canDelete) actionsHTML += `<button class="action-btn" onclick="triggerDelete('${msg._id}')" style="color:#da373c;">🗑️</button>`;
    }

    let replyHTML = "", spacingStyle = "";
    if (msg.replyTo && msg.replyTo.author) {
        spacingStyle = "margin-top: 15px;";
        replyHTML = `<div class="reply-spine"></div><div class="reply-context-line" style="margin-left: 55px;"><span class="reply-name">@${msg.replyTo.author}</span><span class="reply-text">${msg.replyTo.content}</span></div>`;
    }

    let contentHTML = msg.type === "image" ? `<img src="${msg.content}" class="chat-image" onclick="window.open(this.src)">` : `<div class="text-body" id="content-${msg._id}">${formatText(msg.content)}</div>`;
    const editedTag = msg.edited ? '<span class="edited-tag">(modifié)</span>' : '';

    div.innerHTML = `${replyHTML}<div class="msg-actions">${actionsHTML}</div><div style="position:relative; ${spacingStyle}"><img src="${msg.senderAvatar}" class="avatar-img" onclick="openProfile('${msg.senderName.replace(/'/g, "\\'")}')"><div style="margin-left: 55px;"><div class="char-header"><span class="char-name" style="color: ${msg.senderColor}" onclick="openProfile('${msg.senderName.replace(/'/g, "\\'")}')">${msg.senderName}</span><span class="char-role">${msg.senderRole || ""}</span><span class="timestamp">${msg.date} ${editedTag}</span></div>${contentHTML}</div></div>`;
    document.getElementById('messages').appendChild(div);
}

function scrollToBottom() { const d = document.getElementById('messages'); d.scrollTop = d.scrollHeight; }
document.getElementById('txtInput').addEventListener('keyup', (e) => { if(e.key === 'Enter') sendMessage(); });
