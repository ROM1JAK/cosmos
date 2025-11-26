// Initialisation
var socket = io();

// Variables Globales
let myCharacters = [];
let allRooms = []; 
let currentRoomId = 'global'; 
let PLAYER_ID; 

// --- 1. FONCTIONS UTILITAIRES & LOGIN ---

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');
}

// Fonction pour définir ou récupérer l'ID
function getPlayerId() {
    let id = localStorage.getItem('rp_player_id');
    
    // Si pas d'ID, on en génère un aléatoire
    if (!id) { 
        id = 'player_' + Math.random().toString(36).substring(2, 9); 
        localStorage.setItem('rp_player_id', id); 
    }
    
    PLAYER_ID = id;
    
    const displayElement = document.getElementById('player-id-display');
    if(id.startsWith('player_')) {
        displayElement.textContent = `Compte : Invité (Aléatoire)`;
    } else {
        displayElement.textContent = `Compte : ${id}`;
        displayElement.style.color = "#4ade80"; // Vert pour dire connecté
    }
    
    return id;
}

// NOUVEAU : Fonction de Connexion
function loginUser() {
    const newId = prompt("Entrez un Identifiant Secret (mot de passe) pour retrouver vos personnages sur n'importe quel appareil :");
    
    if (newId && newId.trim() !== "") {
        localStorage.setItem('rp_player_id', newId.trim());
        location.reload(); // On recharge la page pour appliquer le changement
    }
}

// Lancer la récupération de l'ID
getPlayerId();


// --- 2. CONNEXION ---

socket.on('connect', () => {
    console.log("Connecté au serveur.");
    socket.emit('request_my_chars', PLAYER_ID);
    socket.emit('request_rooms');
    joinRoom('global');
});


// --- 3. GESTION DES SALONS ---

function createRoomPrompt() {
    const name = prompt("Nom du nouveau salon ?");
    if (name) {
        const roomData = { name: name, creatorId: PLAYER_ID, allowedCharacters: [] };
        socket.emit('create_room', roomData);
    }
}

function joinRoom(roomId) {
    if (currentRoomId && currentRoomId !== roomId) {
        socket.emit('leave_room', currentRoomId);
    }
    currentRoomId = roomId;
    socket.emit('join_room', currentRoomId);
    
    const roomObj = allRooms.find(r => r._id === roomId);
    const roomName = roomObj ? roomObj.name : (roomId === 'global' ? 'Salon Global' : 'Salon Inconnu');
    
    document.getElementById('currentRoomName').textContent = roomName;
    document.getElementById('messages').innerHTML = ""; 
    
    socket.emit('request_history', currentRoomId);
    
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('open')) toggleSidebar(); 
    }
    updateRoomListUI();
}

socket.on('rooms_data', (rooms) => {
    allRooms = rooms;
    updateRoomListUI();
});

function updateRoomListUI() {
    const listDiv = document.getElementById('roomList');
    listDiv.innerHTML = "";
    
    const globalActive = (currentRoomId === 'global') ? 'active' : '';
    listDiv.innerHTML += `<div class="room-item ${globalActive}" onclick="joinRoom('global')">🌐 Salon Global</div>`;

    allRooms.forEach(room => {
        const isActive = (currentRoomId === room._id) ? 'active' : '';
        listDiv.innerHTML += `<div class="room-item ${isActive}" onclick="joinRoom('${room._id}')"># ${room.name}</div>`;
    });
}


// --- 4. GESTION DES PERSONNAGES ---

socket.on('my_chars_data', (chars) => {
    myCharacters = chars;
    updateUI();
});

function createCharacter() {
    const name = document.getElementById('newCharName').value.trim();
    const role = document.getElementById('newCharRole').value.trim();
    const color = document.getElementById('newCharColor').value;
    let avatar = document.getElementById('newCharAvatar').value.trim();
    
    if(!name || !role) return alert("Nom et Rôle obligatoires !");
    if(!avatar) avatar = `https://ui-avatars.com/api/?name=${name}&background=random&color=fff`;

    const charData = { name, role, color, avatar, ownerId: PLAYER_ID };
    socket.emit('create_char', charData);
    
    document.getElementById('newCharName').value = '';
    document.getElementById('newCharRole').value = '';
    document.getElementById('newCharAvatar').value = '';
}

socket.on('char_created_success', (char) => {
    myCharacters.push(char);
    updateUI();
});

function deleteCharacter(name) {
    if(confirm(`Supprimer définitivement "${name}" ?`)) {
        socket.emit('delete_char', name); 
    }
}

socket.on('char_deleted_success', (name) => {
    myCharacters = myCharacters.filter(c => c.name !== name);
    updateUI();
});

function updateUI() {
    const list = document.getElementById('myCharList');
    const select = document.getElementById('charSelector');
    const currentSelection = select.value;

    list.innerHTML = "";
    select.innerHTML = '<option value="Narrateur" data-color="#ffffff" data-avatar="https://cdn-icons-png.flaticon.com/512/1144/1144760.png" data-role="Omniscient">Narrateur</option>';

    myCharacters.forEach(char => {
        list.innerHTML += `
            <div class="char-item" title="Rôle : ${char.role}">
                <img src="${char.avatar}" class="mini-avatar">
                <div style="flex:1;">
                    <div style="color:${char.color}; font-weight:bold;">${char.name}</div>
                    <div style="font-size:0.7em; color:#999;">${char.role}</div>
                </div>
                <button class="btn-delete" onclick="deleteCharacter('${char.name}')">✕</button>
            </div>`;
        
        const option = document.createElement("option");
        option.value = char.name;
        option.text = `${char.name} (${char.role})`;
        option.dataset.color = char.color;
        option.dataset.avatar = char.avatar;
        option.dataset.role = char.role;
        select.appendChild(option);
    });
    
    if (currentSelection === "Narrateur" || myCharacters.some(c => c.name === currentSelection)) {
        select.value = currentSelection;
    }
}


// --- 5. GESTION DU CHAT ---

socket.on('history_data', (messages) => {
     const messagesDiv = document.getElementById('messages');
     messagesDiv.innerHTML = "";
     messages.forEach(msg => displayMessage(msg));
     scrollToBottom();
});

socket.on('message_rp', function(msg) {
    if (msg.roomId === currentRoomId) {
        displayMessage(msg);
        scrollToBottom();
    }
});

function sendMessage() {
    const textInput = document.getElementById('txtInput');
    const content = textInput.value;
    if (content.trim() === "") return;
    sendPayload(content, "text");
    textInput.value = '';
}

function askForImage() {
    const url = prompt("Collez le lien (URL) de l'image ici :");
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
        date: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    };
    socket.emit('message_rp', msgData);
}

function displayMessage(msg) {
    const messagesDiv = document.getElementById('messages');
    const div = document.createElement('div');
    
    const isPrivate = msg.targetName && msg.targetName !== "";
    div.className = isPrivate ? 'message private-msg' : 'message';
    
    let contentHtml = "";
    if (msg.type === "image") {
        contentHtml = `<img src="${msg.content}" class="chat-image" onclick="window.open(this.src)" alt="Image">`;
    } else {
        contentHtml = `<div class="text-body">${msg.content}</div>`;
    }

    let privateBadge = isPrivate ? `<span class="private-badge">🔒 Privé avec ${msg.targetName}</span>` : "";

    div.innerHTML = `
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
    `;
    messagesDiv.appendChild(div);
}

function scrollToBottom() {
    const d = document.getElementById('messages');
    d.scrollTop = d.scrollHeight;
}

document.getElementById("txtInput").addEventListener("keyup", function(e) { 
    if (e.key === "Enter") sendMessage(); 
});
