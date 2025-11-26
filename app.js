var socket = io();
let myCharacters = [];
let allRooms = []; 
let currentRoomId = 'global'; 
let PLAYER_ID; 

// États
let currentContext = null; // { type: 'reply' | 'dm' | 'edit', data: ... }
let typingTimeout = null;

// --- UI & LOGIN ---
function toggleSidebar() { 
    document.getElementById('sidebar').classList.toggle('open'); 
    document.getElementById('mobile-overlay').classList.toggle('open');
}
function toggleCreateForm() { document.getElementById('create-char-form').classList.toggle('hidden'); }

function getPlayerId() {
    let id = localStorage.getItem('rp_player_id');
    if (!id) { id = 'player_' + Math.random().toString(36).substring(2, 9); localStorage.setItem('rp_player_id', id); }
    PLAYER_ID = id;
    document.getElementById('player-id-display').textContent = id.startsWith('player_') ? 'Compte : Invité' : `Compte : ${id}`;
    return id;
}
function loginUser() {
    const newId = prompt("Identifiant secret :");
    if (newId && newId.trim()) { localStorage.setItem('rp_player_id', newId.trim()); location.reload(); }
}
getPlayerId();

// --- SOCKET INIT ---
socket.on('connect', () => {
    socket.emit('request_my_chars', PLAYER_ID);
    socket.emit('request_rooms');
    joinRoom('global');
});

// --- INDICATEUR D'ÉCRITURE ---
const txtInput = document.getElementById('txtInput');
txtInput.addEventListener('input', () => {
    const sel = document.getElementById('charSelector');
    const name = sel.options[sel.selectedIndex]?.text || "Quelqu'un";
    socket.emit('typing_start', { roomId: currentRoomId, charName: name });
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing_stop', { roomId: currentRoomId, charName: name });
    }, 1000);
});

socket.on('display_typing', (data) => {
    if(data.roomId === currentRoomId) {
        document.getElementById('typing-indicator').textContent = `${data.charName} est en train d'écrire...`;
    }
});
socket.on('hide_typing', (data) => {
    if(data.roomId === currentRoomId) {
        document.getElementById('typing-indicator').textContent = "";
    }
});

// --- SALONS ---
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
    document.getElementById('typing-indicator').textContent = "";
    socket.emit('request_history', currentRoomId);
    cancelContext();
    
    if(window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('mobile-overlay').classList.remove('open');
    }
    updateRoomListUI();
}
socket.on('rooms_data', (rooms) => { allRooms = rooms; updateRoomListUI(); });
function updateRoomListUI() {
    const list = document.getElementById('roomList');
    list.innerHTML = `<div class="room-item ${currentRoomId === 'global'?'active':''}" onclick="joinRoom('global')">Salon Global</div>`;
    allRooms.forEach(room => { list.innerHTML += `<div class="room-item ${currentRoomId === room._id?'active':''}" onclick="joinRoom('${room._id}')">${room.name}</div>`; });
}

// --- PERSONNAGES (CRUD) ---
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

// Ouvrir le formulaire de modif
function editCharacter(name, role, avatar, color) {
    document.getElementById('editCharOriginalName').value = name;
    document.getElementById('editCharName').value = name;
    document.getElementById('editCharRole').value = role;
    document.getElementById('editCharAvatar').value = avatar;
    document.getElementById('editCharColor').value = color;
    document.getElementById('edit-char-form').classList.remove('hidden');
    document.getElementById('create-char-form').classList.add('hidden');
}
function cancelEditCharacter() {
    document.getElementById('edit-char-form').classList.add('hidden');
}
function submitEditCharacter() {
    const originalName = document.getElementById('editCharOriginalName').value;
    const newName = document.getElementById('editCharName').value.trim();
    const newRole = document.getElementById('editCharRole').value.trim();
    const newAvatar = document.getElementById('editCharAvatar').value.trim();
    const newColor = document.getElementById('editCharColor').value;
    
    socket.emit('edit_char', { originalName, newName, newRole, newAvatar, newColor, ownerId: PLAYER_ID });
    cancelEditCharacter();
}

socket.on('my_chars_data', (chars) => { myCharacters = chars; updateUI(); });
socket.on('char_created_success', (char) => { myCharacters.push(char); updateUI(); });
function deleteCharacter(name) { if(confirm('Supprimer ce personnage ?')) socket.emit('delete_char', name); }
socket.on('char_deleted_success', (name) => { myCharacters = myCharacters.filter(c => c.name !== name); updateUI(); });

function updateUI() {
    const list = document.getElementById('myCharList');
    const select = document.getElementById('charSelector');
    const prev = select.value;
    list.innerHTML = "";
    select.innerHTML = '<option value="Narrateur" data-color="#ffffff" data-avatar="https://cdn-icons-png.flaticon.com/512/1144/1144760.png" data-role="Omniscient">Narrateur</option>';
    
    myCharacters.forEach(char => {
        // Liste Sidebar avec bouton Edit et Delete
        list.innerHTML += `
            <div class="char-item">
                <img src="${char.avatar}" class="mini-avatar">
                <div class="char-info">
                    <div class="char-name-list" style="color:${char.color}">${char.name}</div>
                    <div class="char-role-list">${char.role}</div>
                </div>
                <div class="char-actions">
                    <button class="btn-mini-action" onclick="editCharacter('${char.name}', '${char.role}', '${char.avatar}', '${char.color}')">⚙️</button>
                    <button class="btn-mini-action" onclick="deleteCharacter('${char.name}')" style="color:#da373c;">✕</button>
                </div>
            </div>`;
        
        // Select
        const opt = document.createElement('option');
        opt.value = char.name; opt.text = char.name; 
        opt.dataset.color = char.color; opt.dataset.avatar = char.avatar; opt.dataset.role = char.role;
        select.appendChild(opt);
    });
    if (prev && (prev === "Narrateur" || myCharacters.some(c => c.name === prev))) select.value = prev;
}

// --- ACTIONS CONTEXTUELLES (REPLY, DM, EDIT) ---
function setContext(type, data) {
    currentContext = { type, data };
    const bar = document.getElementById('context-bar');
    const icon = document.getElementById('context-icon');
    const text = document.getElementById('context-text');
    
    bar.className = 'visible'; // Afficher
    document.getElementById('txtInput').focus();

    if (type === 'reply') {
        icon.textContent = "↩️";
        text.innerHTML = `Répondre à <strong>${data.author}</strong>`;
    } else if (type === 'dm') {
        icon.textContent = "✉️";
        text.innerHTML = `Message Privé pour <strong>${data.target}</strong>`;
        bar.style.borderLeft = "3px solid #da373c";
    } else if (type === 'edit') {
        icon.textContent = "✏️";
        text.innerHTML = `Modification du message`;
        document.getElementById('txtInput').value = data.content;
    }
}

function cancelContext() {
    currentContext = null;
    document.getElementById('context-bar').className = 'hidden';
    document.getElementById('context-bar').style.borderLeft = "none";
    if (document.getElementById('txtInput').value !== "") document.getElementById('txtInput').value = "";
}

function triggerReply(id, author, content) { setContext('reply', { id, author, content }); }
function triggerDM(name) { setContext('dm', { target: name }); }
function triggerEdit(id, content) { setContext('edit', { id, content }); }

function triggerDelete(id) {
    if(confirm("Supprimer ce message ?")) {
        socket.emit('delete_message', id);
    }
}

// --- ENVOI ---
function sendMessage() {
    const txt = document.getElementById('txtInput');
    const content = txt.value.trim();
    if (!content) return;
    
    // Si on est en mode ÉDITION
    if (currentContext && currentContext.type === 'edit') {
        socket.emit('edit_message', { id: currentContext.data.id, newContent: content });
        txt.value = '';
        cancelContext();
        return;
    }

    // Sinon Envoi normal
    const sel = document.getElementById('charSelector');
    const opt = sel.options[sel.selectedIndex];
    
    // Calcul de la cible (MP)
    let target = "";
    if (currentContext && currentContext.type === 'dm') {
        target = currentContext.data.target;
    }

    const msg = {
        content, type: "text",
        senderName: opt.value, senderColor: opt.dataset.color || "#fff", senderAvatar: opt.dataset.avatar, senderRole: opt.dataset.role,
        ownerId: PLAYER_ID, // Pour savoir si on peut edit
        targetName: target, roomId: currentRoomId,
        date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
        replyTo: (currentContext && currentContext.type === 'reply') ? {
            id: currentContext.data.id, author: currentContext.data.author, content: currentContext.data.content
        } : null
    };
    
    socket.emit('message_rp', msg);
    txt.value = '';
    cancelContext();
}

function askForImage() {
    const url = prompt("URL de l'image :");
    if(url) {
         // Même logique pour l'image (pas d'edit possible sur image pour l'instant)
         const sel = document.getElementById('charSelector');
         const opt = sel.options[sel.selectedIndex];
         let target = (currentContext && currentContext.type === 'dm') ? currentContext.data.target : "";
         
         const msg = {
            content: url, type: "image",
            senderName: opt.value, senderColor: opt.dataset.color || "#fff", senderAvatar: opt.dataset.avatar, senderRole: opt.dataset.role,
            ownerId: PLAYER_ID, targetName: target, roomId: currentRoomId,
            date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
            replyTo: null
        };
        socket.emit('message_rp', msg);
    }
}

// --- AFFICHAGE ---
socket.on('history_data', (msgs) => { document.getElementById('messages').innerHTML = ""; msgs.forEach(displayMessage); scrollToBottom(); });
socket.on('message_rp', (msg) => { if(msg.roomId === currentRoomId) { displayMessage(msg); scrollToBottom(); } });

// Mise à jour temps réel (Edit/Delete)
socket.on('message_deleted', (msgId) => {
    const el = document.getElementById(`msg-${msgId}`);
    if(el) el.remove();
});
socket.on('message_updated', (data) => {
    const el = document.getElementById(`content-${data.id}`);
    if(el) {
        el.textContent = data.newContent;
        // Ajout du tag (modifié) si pas déjà là
        const meta = el.parentElement.parentElement.querySelector('.timestamp');
        if(!meta.textContent.includes('(modifié)')) meta.textContent += ' (modifié)';
    }
});


function displayMessage(msg) {
    const div = document.createElement('div');
    const isPrivate = msg.targetName && msg.targetName !== "";
    div.className = 'message-container';
    div.id = `msg-${msg._id}`; // ID pour suppression DOM

    // Boutons d'action : Afficher Edit/Delete SEULEMENT si c'est mon message
    // (Vérification simple via PLAYER_ID, pas ultra sécurisé mais ok pour RP entre amis)
    const isMine = msg.ownerId === PLAYER_ID;
    
    let actionsHTML = `
        <button class="action-btn" onclick="triggerReply('${msg._id}', '${msg.senderName.replace(/'/g, "\\'")}', '${msg.content.replace(/'/g, "\\'")}')" title="Répondre">↩️</button>
        <button class="action-btn" onclick="triggerDM('${msg.senderName.replace(/'/g, "\\'")}')" title="MP">✉️</button>
    `;
    
    if (isMine && msg.type === 'text') {
        actionsHTML += `
            <button class="action-btn" onclick="triggerEdit('${msg._id}', '${msg.content.replace(/'/g, "\\'")}')" title="Modifier">✏️</button>
            <button class="action-btn" onclick="triggerDelete('${msg._id}')" title="Supprimer" style="color:#da373c;">🗑️</button>
        `;
    }

    // Réponse
    let replyHTML = "";
    let spacingStyle = "";
    if (msg.replyTo && msg.replyTo.author) {
        spacingStyle = "margin-top: 15px;";
        replyHTML = `
            <div class="reply-spine"></div>
            <div class="reply-context-line" style="margin-left: 55px;">
                <span class="reply-name">@${msg.replyTo.author}</span>
                <span class="reply-text">${msg.replyTo.content}</span>
            </div>`;
    }

    // Contenu
    let contentHTML = msg.type === "image" 
        ? `<img src="${msg.content}" class="chat-image" onclick="window.open(this.src)">` 
        : `<div class="text-body" id="content-${msg._id}">${msg.content}</div>`;

    const editedTag = msg.edited ? '<span class="edited-tag">(modifié)</span>' : '';

    div.innerHTML = `
        ${replyHTML}
        <div class="msg-actions">${actionsHTML}</div>
        <div style="position:relative; ${spacingStyle} ${isPrivate ? 'background:rgba(218, 55, 60, 0.05); border-radius:4px;' : ''}">
            <img src="${msg.senderAvatar}" class="avatar-img">
            <div style="margin-left: 55px;">
                <div class="char-header">
                    <span class="char-name" style="color: ${msg.senderColor}">${msg.senderName}</span>
                    <span class="char-role">${msg.senderRole || ""}</span>
                    <span class="timestamp">${msg.date} ${editedTag}</span>
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
