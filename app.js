// Initialisation de la connexion Socket.io
var socket = io();

// Variables Globales
let myCharacters = [];
let allRooms = []; 
let currentRoomId = 'global'; 
let PLAYER_ID; 

// --- 1. FONCTIONS UTILITAIRES & MOBILE ---

// Ouvrir/Fermer la sidebar sur mobile
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');
}

// Générer ou récupérer l'ID unique du joueur
function generateUniqueId() { 
    return 'player_' + Math.random().toString(36).substring(2, 9); 
}

function getPlayerId() {
    let id = localStorage.getItem('rp_player_id');
    if (!id) { 
        id = generateUniqueId(); 
        localStorage.setItem('rp_player_id', id); 
    }
    PLAYER_ID = id;
    // Affichage discret dans la sidebar
    const displayElement = document.getElementById('player-id-display');
    if(displayElement) displayElement.textContent = `ID Joueur: ${id.substring(7)}`;
    return id;
}

// Lancer la récupération de l'ID dès le chargement du script
getPlayerId();


// --- 2. CONNEXION ET INITIALISATION ---

socket.on('connect', () => {
    console.log("Connecté au serveur.");
    
    // 1. Demander mes persos (liés à mon ID)
    socket.emit('request_my_chars', PLAYER_ID);
    
    // 2. Demander la liste des salons
    socket.emit('request_rooms');
    
    // 3. Rejoindre le salon par défaut (Global) si on n'y est pas déjà
    // (On force le rejoin pour être sûr d'avoir l'historique à jour)
    joinRoom('global');
});


// --- 3. GESTION DES SALONS (ROOMS) ---

// Demander la création d'un salon
function createRoomPrompt() {
    const name = prompt("Quel nom voulez-vous donner au nouveau Salon ?");
    if (name) {
        const roomData = { 
            name: name, 
            creatorId: PLAYER_ID,
            allowedCharacters: [] 
        };
        socket.emit('create_room', roomData);
    }
}

// Rejoindre un salon spécifique
function joinRoom(roomId) {
    // Quitter l'ancien salon si nécessaire
    if (currentRoomId && currentRoomId !== roomId) {
        socket.emit('leave_room', currentRoomId);
    }
    
    currentRoomId = roomId;
    socket.emit('join_room', currentRoomId);
    
    // Mise à jour visuelle
    const roomObj = allRooms.find(r => r._id === roomId);
    const roomName = roomObj ? roomObj.name : (roomId === 'global' ? 'Salon Global' : 'Salon Inconnu');
    
    document.getElementById('currentRoomName').textContent = roomName;
    document.getElementById('messages').innerHTML = ""; // On vide le chat avant de charger le nouveau
    
    // Demander l'historique
    socket.emit('request_history', currentRoomId);
    
    // Si on est sur mobile, on ferme le menu après avoir cliqué
    if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        if (sidebar.classList.contains('open')) {
            toggleSidebar(); 
        }
    }
    
    updateRoomListUI();
}

// Réception de la liste des salons
socket.on('rooms_data', (rooms) => {
    allRooms = rooms;
    updateRoomListUI();
});

// Affichage de la liste des salons dans la sidebar
function updateRoomListUI() {
    const listDiv = document.getElementById('roomList');
    listDiv.innerHTML = "";
    
    // Toujours afficher le Global en premier
    const globalActive = (currentRoomId === 'global') ? 'active' : '';
    listDiv.innerHTML += `
        <div class="room-item ${globalActive}" onclick="joinRoom('global')">
            🌐 Salon Global
        </div>`;

    allRooms.forEach(room => {
        const isActive = (currentRoomId === room._id) ? 'active' : '';
        listDiv.innerHTML += `
            <div class="room-item ${isActive}" onclick="joinRoom('${room._id}')">
                # ${room.name}
            </div>`;
    });
}


// --- 4. GESTION DES PERSONNAGES ---

// Réception de mes personnages
socket.on('my_chars_data', (chars) => {
    myCharacters = chars;
    updateUI();
});

// Créer un personnage
function createCharacter() {
    const name = document.getElementById('newCharName').value.trim();
    const role = document.getElementById('newCharRole').value.trim();
    const color = document.getElementById('newCharColor').value;
    let avatar = document.getElementById('newCharAvatar').value.trim();
    
    if(!name || !role) return alert("Nom et Rôle obligatoires !");

    if(!avatar) avatar = `https://ui-avatars.com/api/?name=${name}&background=random&color=fff`;

    const charData = { 
        name, role, color, avatar, 
        ownerId: PLAYER_ID 
    };

    socket.emit('create_char', charData);
    
    // Reset des champs
    document.getElementById('newCharName').value = '';
    document.getElementById('newCharRole').value = '';
    document.getElementById('newCharAvatar').value = '';
}

// Confirmation de création
socket.on('char_created_success', (char) => {
    myCharacters.push(char);
    updateUI();
});

// Supprimer un personnage
function deleteCharacter(name) {
    if(confirm(`Supprimer définitivement "${name}" ?`)) {
        socket.emit('delete_char', name); 
    }
}

// Confirmation de suppression
socket.on('char_deleted_success', (name) => {
    myCharacters = myCharacters.filter(c => c.name !== name);
    updateUI();
});

// Mise à jour de l'interface (Liste sidebar + Selecteur Chat)
function updateUI() {
    const list = document.getElementById('myCharList');
    const select = document.getElementById('charSelector');
    const currentSelection = select.value;

    list.innerHTML = "";
    // Option par défaut
    select.innerHTML = '<option value="Narrateur" data-color="#ffffff" data-avatar="https://cdn-icons-png.flaticon.com/512/1144/1144760.png" data-role="Omniscient">Narrateur</option>';

    myCharacters.forEach(char => {
        // Liste Sidebar
        list.innerHTML += `
            <div class="char-item" title="Rôle : ${char.role}">
                <img src="${char.avatar}" class="mini-avatar">
                <div style="flex:1;">
                    <div style="color:${char.color}; font-weight:bold;">${char.name}</div>
                    <div style="font-size:0.7em; color:#999;">${char.role}</div>
                </div>
                <button class="btn-delete" onclick="deleteCharacter('${char.name}')">✕</button>
            </div>`;
        
        // Menu Déroulant Chat
        const option = document.createElement("option");
        option.value = char.name;
        option.text = `${char.name} (${char.role})`;
        option.dataset.color = char.color;
        option.dataset.avatar = char.avatar;
        option.dataset.role = char.role;
        select.appendChild(option);
    });
    
    // Restaurer la sélection si possible
    if (currentSelection === "Narrateur" || myCharacters.some(c => c.name === currentSelection)) {
        select.value = currentSelection;
    }
}


// --- 5. GESTION DU CHAT ---

// Réception de l'historique
socket.on('history_data', (messages) => {
     const messagesDiv = document.getElementById('messages');
     messagesDiv.innerHTML = "";
     messages.forEach(msg => displayMessage(msg));
     scrollToBottom();
});

// Réception d'un nouveau message
socket.on('message_rp', function(msg) {
    // Sécurité : on n'affiche que si c'est le bon salon
    if (msg.roomId === currentRoomId) {
        displayMessage(msg);
        scrollToBottom();
    }
});

// Envoyer un message texte
function sendMessage() {
    const textInput = document.getElementById('txtInput');
    const content = textInput.value;
    
    if (content.trim() === "") return;

    sendPayload(content, "text");
    textInput.value = '';
}

// Envoyer une image
function askForImage() {
    const url = prompt("URL de l'image :");
    if(url) {
        sendPayload(url, "image");
    }
}

// Fonction centrale d'envoi
function sendPayload(content, type) {
    const selector = document.getElementById('charSelector');
    const selectedOption = selector.options[selector.selectedIndex];
    const targetInput = document.getElementById('targetInput');
    
    const msgData = {
        content: content,
        type: type,
        
        // Expéditeur
        senderName: selectedOption.value,
        senderColor: selectedOption.dataset.color || "#ffffff",
        senderAvatar: selectedOption.dataset.avatar,
        senderRole: selectedOption.dataset.role || "",
        
        // Cible & Lieu
        targetName: targetInput.value.trim(),
        roomId: currentRoomId,
        
        // Heure
        date: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
    };

    socket.emit('message_rp', msgData);
}

// Affichage d'un message dans le HTML
function displayMessage(msg) {
    const messagesDiv = document.getElementById('messages');
    const div = document.createElement('div');
    
    const isPrivate = msg.targetName && msg.targetName !== "";
    div.className = isPrivate ? 'message private-msg' : 'message';
    
    // Contenu (Texte vs Image)
    let contentHtml = "";
    if (msg.type === "image") {
        contentHtml = `<img src="${msg.content}" class="chat-image" onclick="window.open(this.src)" alt="Image envoyée">`;
    } else {
        contentHtml = `<div class="text-body">${msg.content}</div>`;
    }

    // Badge privé
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

// Scroll automatique en bas
function scrollToBottom() {
    const d = document.getElementById('messages');
    d.scrollTop = d.scrollHeight;
}

// Gestion de la touche "Entrée"
document.getElementById("txtInput").addEventListener("keyup", function(e) { 
    if (e.key === "Enter") sendMessage(); 
});