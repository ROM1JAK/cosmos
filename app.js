// Initialisation
var socket = io();

// Variables Globales
let myCharacters = [];
let allRooms = []; 
let currentRoomId = 'global'; 
let PLAYER_ID; 

// Variable pour stocker la réponse en cours (null si on ne répond pas)
let currentReply = null; 

// --- 1. FONCTIONS UTILITAIRES & LOGIN ---
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }

function getPlayerId() {
    let id = localStorage.getItem('rp_player_id');
    if (!id) { 
        id = 'player_' + Math.random().toString(36).substring(2, 9); 
        localStorage.setItem('rp_player_id', id); 
    }
    PLAYER_ID = id;
    const displayElement = document.getElementById('player-id-display');
    if(id.startsWith('player_')) { displayElement.textContent = `Compte : Invité`; } 
    else { displayElement.textContent = `Compte : ${id}`; displayElement.style.color = "#4ade80"; }
    return id;
}
function loginUser() {
    const newId = prompt("Entrez un Identifiant Secret :");
    if (newId && newId.trim() !== "") { localStorage.setItem('rp_player_id', newId.trim()); location.reload(); }
}
getPlayerId();

// --- 2. CONNEXION ---
socket.on('connect', () => {
    socket.emit('request_my_chars', PLAYER_ID);
    socket.emit('request_rooms');
    joinRoom('global');
});

// --- 3. GESTION DES SALONS ---
function createRoomPrompt() {
    const name = prompt("Nom du nouveau salon ?");
    if (name) { socket.emit('create_room', { name: name, creatorId: PLAYER_ID, allowedCharacters: [] }); }
}
function joinRoom(roomId) {
    if (currentRoomId && currentRoomId !== roomId) socket.emit('leave_room', currentRoomId);
    currentRoomId = roomId;
    socket.emit('join_room', currentRoomId);
    
    const roomObj = allRooms.find(r => r._id === roomId);
    document.getElementById('currentRoomName').textContent = roomObj ? roomObj.name : 'Salon Global';
    document.getElementById('messages').innerHTML = ""; 
    socket.emit('request_history', currentRoomId);
    cancelReply(); // Annuler toute réponse en cours en changeant de salle
    updateRoomListUI();
}
socket.on('rooms_data', (rooms) => { allRooms = rooms; updateRoomListUI(); });
function updateRoomListUI() {
    const listDiv = document.getElementById('roomList');
    listDiv.innerHTML = `<div class="room-item ${currentRoomId === 'global'?'active':''}" onclick="joinRoom('global')">🌐 Salon Global</div>`;
    allRooms.forEach(room => { listDiv.innerHTML += `<div class="room-item ${currentRoomId === room._id?'active':''}" onclick="joinRoom('${room._id}')"># ${room.name}</div>`; });
}

// --- 4. GESTION DES PERSONNAGES ---
socket.on('my_chars_data', (chars) => { myCharacters = chars; updateUI(); });
function createCharacter() {
    const name = document.getElementById('newCharName').value.trim();
    const role = document.getElementById('newCharRole').value.trim();
    const color = document.getElementById('newCharColor').value;
    let avatar = document.getElementById('newCharAvatar').value.trim();
    if(!name || !role) return alert("Nom et Rôle obligatoires !");
    if(!avatar) avatar = `https://ui-avatars.com/api/?name=${name}&background=random&color=fff`;
    socket.emit('create_char', { name, role, color, avatar, ownerId: PLAYER_ID });
    document.getElementById('newCharName').value = '';
}
socket.on('char_created_success', (char) => { myCharacters.push(char); updateUI(); });
function deleteCharacter(name) { if(confirm(`Supprimer ?`)) socket.emit('delete_char', name); }
socket.on('char_deleted_success', (name) => { myCharacters = myCharacters.filter(c => c.name !== name); updateUI(); });

function updateUI() {
    const list = document.getElementById('myCharList');
    const select = document.getElementById('charSelector');
    const currentSelection = select.value;
    list.innerHTML = "";
    select.innerHTML = '<option value="Narrateur" data-color="#ffffff" data-avatar="https://cdn-icons-png.flaticon.com/512/1144/1144760.png" data-role="Omniscient">Narrateur</option>';
    myCharacters.forEach(char => {
        list.innerHTML += `<div class="char-item"><img src="${char.avatar}" class="mini-avatar"><div style="flex:1;"><div style="color:${char.color}">${char.name}</div></div><button class="btn-delete" onclick="deleteCharacter('${char.name}')">✕</button></div>`;
        const option = document.createElement("option");
        option.value = char.name; option.text = `${char.name}`; option.dataset.color = char.color; option.dataset.avatar = char.avatar; option.dataset.role = char.role;
        select.appendChild(option);
    });
    if (currentSelection === "Narrateur" || myCharacters.some(c => c.name === currentSelection)) select.value = currentSelection;
}

// --- 5. GESTION DU CHAT & RÉPONSES (C'EST ICI QUE ÇA BOUGE) ---

// A. GESTION DE L'INTERFACE DE RÉPONSE
function triggerReply(msgId, author, content, avatar) {
    // On stocke les infos de la réponse
    currentReply = { id: msgId, author: author, content: content, avatar: avatar };
    
    // On affiche la barre de prévisualisation
    const replyBar = document.getElementById('reply-bar');
    const replyName = document.getElementById('reply-target-name');
    
    replyBar.style.display = 'flex';
    replyName.textContent = author;
    
    // On focus le champ texte
    document.getElementById('txtInput').focus();
}

function cancelReply() {
    currentReply = null;
    document.getElementById('reply-bar').style.display = 'none';
}

// B. GESTION DE L'INTERFACE MP (Remplir le champ cible)
function triggerDM(targetName) {
    const targetInput = document.getElementById('targetInput');
    targetInput.value = targetName;
    targetInput.style.borderColor = "#ff6b6b"; // Petit effet visuel
    setTimeout(() => targetInput.style.borderColor = "transparent", 1000);
    document.getElementById('txtInput').focus();
}

// C. ENVOI DU MESSAGE
function sendMessage() {
    const textInput = document.getElementById('txtInput');
    const content = textInput.value;
    if (content.trim() === "") return;
    sendPayload(content, "text");
    textInput.value = '';
    cancelReply(); // On retire la barre de réponse après envoi
}

function askForImage() {
    const url = prompt("URL de l'image :");
    if(url) sendPayload(url, "image");
}

function sendPayload(content, type) {
    const selector = document.getElementById('charSelector');
    const selectedOption = selector.options[selector.selectedIndex];
    const targetInput = document.getElementById('targetInput');
    
    const msgData = {
        content: content,
        type: type,
        senderName: selectedOption.value,
        senderColor: selectedOption.dataset.color || "#ffffff",
        senderAvatar: selectedOption.dataset.avatar,
        senderRole: selectedOption.dataset.role || "",
        targetName: targetInput.value.trim(),
        roomId: currentRoomId,
        date: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
        
        // NOUVEAU : On attache l'objet de réponse s'il existe
        replyTo: currentReply ? {
            author: currentReply.author,
            content: currentReply.content,
            id: currentReply.id
        } : null
    };
    socket.emit('message_rp', msgData);
}

// D. AFFICHAGE DES MESSAGES
socket.on('history_data', (messages) => {
     document.getElementById('messages').innerHTML = "";
     messages.forEach(msg => displayMessage(msg));
     scrollToBottom();
});

socket.on('message_rp', function(msg) {
    if (msg.roomId === currentRoomId) {
        displayMessage(msg);
        scrollToBottom();
    }
});

function displayMessage(msg) {
    const messagesDiv = document.getElementById('messages');
    
    // Conteneur global (pour les boutons d'action)
    const container = document.createElement('div');
    container.className = 'message-container';
    
    const isPrivate = msg.targetName && msg.targetName !== "";
    const msgClass = isPrivate ? 'message private-msg' : 'message';
    
    // Préparation du contenu (Texte ou Image)
    let contentHtml = "";
    if (msg.type === "image") {
        contentHtml = `<img src="${msg.content}" class="chat-image" onclick="window.open(this.src)" alt="Image">`;
    } else {
        contentHtml = `<div class="text-body">${msg.content}</div>`;
    }
    let privateBadge = isPrivate ? `<span class="private-badge">🔒 Privé avec ${msg.targetName}</span>` : "";

    // GESTION VISUELLE DE LA RÉPONSE (LA LIGNE COURBÉE)
    let replyHtml = "";
    if (msg.replyTo && msg.replyTo.author) {
        replyHtml = `
            <div class="reply-context">
                <img src="https://ui-avatars.com/api/?name=${msg.replyTo.author}&background=random" class="reply-avatar-mini">
                <span class="reply-name">@${msg.replyTo.author}</span>
                <span class="reply-text">${msg.replyTo.content}</span>
            </div>
        `;
    }

    // Le HTML final du bloc
    // Note les fonctions onclick dans les boutons d'action
    // On échappe les guillemets simples dans le contenu pour éviter les bugs JS dans le onclick
    const safeContent = msg.content.replace(/'/g, "\\'"); 
    const safeAuthor = msg.senderName.replace(/'/g, "\\'");

    container.innerHTML = `
        ${replyHtml} <div class="msg-actions">
            <button class="action-btn" onclick="triggerReply('${msg._id}', '${safeAuthor}', '${safeContent}', '${msg.senderAvatar}')" title="Répondre">↩️</button>
            <button class="action-btn" onclick="triggerDM('${safeAuthor}')" title="Message Privé">✉️</button>
        </div>

        <div class="${msgClass}">
            <img src="${msg.senderAvatar}" class="avatar-img">
            <div class="message-content">
                <div class="char-header">
                    <span class="char-name" style="color: ${msg.senderColor}">${msg.senderName}</span>
                    <span class="char-role">${msg.senderRole || ""}</span>
                    <span class="timestamp">${msg.date}</span>
                    ${privateBadge}
                </div>
                ${contentHtml}
            </div>
        </div>
    `;
    
    messagesDiv.appendChild(container);
}

function scrollToBottom() { const d = document.getElementById('messages'); d.scrollTop = d.scrollHeight; }
document.getElementById("txtInput").addEventListener("keyup", function(e) { if (e.key === "Enter") sendMessage(); });
