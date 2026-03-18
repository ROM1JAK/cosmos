var socket = io();
const notifSound = new Audio('https://cdn.discordapp.com/attachments/1323488087288053821/1443747694408503446/notif.mp3'); 

const CLOUDINARY_BASE_URL = 'https://api.cloudinary.com/v1_1/dllr3ugxz'; 
const CLOUDINARY_PRESET = 'Cosmos';

// --- DATA ---
let myCharacters = [];
let allRooms = []; 
let currentRoomId = 'global'; 
let currentDmTarget = null; 
let PLAYER_ID; 
let USERNAME; 
let IS_ADMIN = false;
let currentContext = null; 
let typingTimeout = null;
let feedTypingTimeout = null;
let unreadRooms = new Set();
let unreadDms = new Set(); 
let dmContacts = []; 
let firstUnreadMap = {}; 
let currentView = 'chat'; 
let notificationsEnabled = true; 
let currentSelectedChar = null; 
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let allOnlineUsers = []; 

// FEED IDENTITY
let currentFeedCharId = null;

// Staging Vars
let pendingAttachment = null; 
let pendingCommentAttachment = null;
let lastMessageData = { author: null, time: 0, ownerId: null };

// POLITIQUES RP
let pollOptions = [];
let pollUIOpen = false; 

const COMMON_EMOJIS = ["😀", "😂", "😉", "😍", "😎", "🥳", "😭", "😡", "🤔", "👍", "👎", "❤️", "💔", "🔥", "✨", "🎉", "💩", "👻", "💀", "👽", "🤖", "👋", "🙌", "🙏", "💪", "👀", "🍕", "🍻", "🚀", "💯"];

async function uploadToCloudinary(file, resourceType) {
    if (!file) return null;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_PRESET);
    const uploadUrl = `${CLOUDINARY_BASE_URL}/${resourceType || 'auto'}/upload`;
    try {
        const response = await fetch(uploadUrl, { method: 'POST', body: formData });
        const data = await response.json();
        return data.secure_url; 
    } catch (error) {
        console.error("Erreur Upload:", error);
        return null;
    }
}

function switchView(view) {
    currentView = view;
    localStorage.setItem('last_tab', view);
    document.querySelectorAll('.view-section').forEach(el => { el.classList.remove('active'); el.classList.add('hidden'); });
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.remove('hidden');
    document.getElementById(`view-${view}`).classList.add('active');
    document.getElementById(`btn-view-${view}`).classList.add('active');
    if(view === 'feed') {
        document.getElementById('btn-view-feed').classList.remove('nav-notify');
        localStorage.setItem('last_feed_visit', Date.now().toString());
        loadFeed();
    }
}

function changeTheme(theme) {
    document.body.dataset.theme = theme;
    document.querySelectorAll('.theme-swatch').forEach(el => {
        el.classList.toggle('active', el.dataset.theme === theme);
    });
    if (PLAYER_ID) socket.emit('save_theme', { userId: PLAYER_ID, theme });
}

async function toggleRecording(source) { 
    const btnId = `btn-record-${source}`;
    const btn = document.getElementById(btnId);
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.start();
            isRecording = true;
            btn.classList.add('recording');
        } catch (err) { console.error(err); }
    } else {
        mediaRecorder.stop();
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            btn.classList.remove('recording');
            isRecording = false;
            if (source === 'chat') { stageAttachment(audioBlob, 'audio'); } 
            else if (source === 'feed') {
                const url = await uploadToCloudinary(audioBlob, 'video');
                if (url) document.getElementById('postMediaUrl').value = url;
            } else if (source === 'comment') { stageCommentMedia({ files: [audioBlob] }, 'audio'); }
        };
    }
}

function handleChatFileSelect(input, type) { if (input.files && input.files[0]) { stageAttachment(input.files[0], type); input.value = ""; } }
function stageAttachment(file, type) {
    pendingAttachment = { file, type };
    const stagingDiv = document.getElementById('chat-staging');
    stagingDiv.classList.remove('hidden');
    stagingDiv.innerHTML = `<span class="staging-info">${type === 'audio' ? 'Message Vocal' : file.name}</span><button class="btn-clear-stage" onclick="clearStaging()">X</button>`;
}
function clearStaging() { pendingAttachment = null; document.getElementById('chat-staging').classList.add('hidden'); }

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('mobile-overlay').classList.toggle('open'); }
function toggleCreateForm() { document.getElementById('create-char-form').classList.toggle('hidden'); }
function toggleNotifications() { notificationsEnabled = !notificationsEnabled; }
function openAccountUI() { if (PLAYER_ID) openUserSettingsModal(); else openLoginModal(); }
function openLoginModal() { document.getElementById('login-modal').classList.remove('hidden'); }
function closeLoginModal() { document.getElementById('login-modal').classList.add('hidden'); }
function submitLogin() { const pseudo = document.getElementById('loginPseudoInput').value.trim(); const code = document.getElementById('loginCodeInput').value.trim(); if (pseudo && code) socket.emit('login_request', { username: pseudo, code: code }); }
function logoutUser() { localStorage.clear(); location.reload(); }
function openUserSettingsModal() { document.getElementById('settingsUsernameInput').value = USERNAME || ""; document.getElementById('user-settings-modal').classList.remove('hidden'); }
function closeUserSettingsModal() { document.getElementById('user-settings-modal').classList.add('hidden'); }
function toggleSecretVisibility() { const i = document.getElementById('settingsCodeInput'); i.type = (i.type === "password") ? "text" : "password"; }
function submitUsernameChange() {
    const newName = document.getElementById('settingsUsernameInput').value.trim();
    if (newName && newName !== USERNAME) socket.emit('change_username', { userId: PLAYER_ID, newUsername: newName });
}

socket.on('login_success', (data) => {
    localStorage.setItem('rp_username', data.username);
    localStorage.setItem('rp_code', data.userId);
    USERNAME = data.username;
    PLAYER_ID = data.userId;
    IS_ADMIN = data.isAdmin;
    document.getElementById('player-id-display').textContent = USERNAME;
    document.getElementById('btn-account-main').innerHTML = '<i class="fa-solid fa-user"></i> Profil';
    closeLoginModal();
    if (data.uiTheme) changeTheme(data.uiTheme);
    socket.emit('request_initial_data', PLAYER_ID);
    const lastTab = localStorage.getItem('last_tab');
    if (lastTab) switchView(lastTab);
    joinRoom(localStorage.getItem('saved_room_id') || 'global');
});

socket.on('connect', () => {
    const savedUser = localStorage.getItem('rp_username');
    const savedCode = localStorage.getItem('rp_code');
    if (savedUser && savedCode) socket.emit('login_request', { username: savedUser, code: savedCode });
    else openLoginModal();
});

socket.on('update_user_list', (users) => {
    allOnlineUsers = users;
    const listDiv = document.getElementById('online-users-list');
    document.getElementById('online-count').textContent = users.length;
    listDiv.innerHTML = "";
    users.forEach(u => listDiv.innerHTML += `<div class="online-user" onclick="openDm('${u}')"><span class="status-dot"></span><span>${u}</span></div>`);
});

const txtInput = document.getElementById('txtInput');
txtInput.addEventListener('input', () => {
    if(currentDmTarget) return; 
    const name = currentSelectedChar ? currentSelectedChar.name : "Quelqu'un";
    socket.emit('typing_start', { roomId: currentRoomId, charName: name });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { socket.emit('typing_stop', { roomId: currentRoomId, charName: name }); }, 1000);
});

document.getElementById('postContent').addEventListener('input', (e) => {
    document.getElementById('char-count').textContent = `${e.target.value.length}/1000`;
    const name = currentFeedCharId ? (myCharacters.find(c => c._id === currentFeedCharId)?.name || USERNAME) : USERNAME;
    socket.emit('typing_feed_start', { charName: name });
    clearTimeout(feedTypingTimeout);
    feedTypingTimeout = setTimeout(() => { socket.emit('typing_feed_stop', { charName: name }); }, 1500);
});

socket.on('display_typing', (data) => { if(data.roomId === currentRoomId) { document.getElementById('typing-indicator').classList.remove('hidden'); document.getElementById('typing-text').textContent = `${data.charName} écrit...`; } });
socket.on('hide_typing', (data) => { if(data.roomId === currentRoomId) document.getElementById('typing-indicator').classList.add('hidden'); });

socket.on('display_feed_typing', (data) => {
    const el = document.getElementById('feed-typing-indicator');
    el.textContent = `${data.charName} est en train d'écrire un post...`;
    el.classList.remove('hidden');
});
socket.on('hide_feed_typing', () => {
    document.getElementById('feed-typing-indicator').classList.add('hidden');
});

function createRoomPrompt() { const name = prompt("Nom du salon :"); if (name) socket.emit('create_room', { name, creatorId: PLAYER_ID }); }
function joinRoom(roomId) {
    if (currentRoomId && currentRoomId !== roomId) socket.emit('leave_room', currentRoomId);
    currentRoomId = roomId;
    localStorage.setItem('saved_room_id', roomId);
    currentDmTarget = null; 
    socket.emit('join_room', currentRoomId);
    document.getElementById('currentRoomName').textContent = allRooms.find(r => r._id === roomId)?.name || 'Salon Global';
    document.getElementById('messages').innerHTML = ""; 
    socket.emit('request_history', currentRoomId);
    updateRoomListUI(); updateDmListUI(); switchView('chat'); 
}
socket.on('rooms_data', (rooms) => { allRooms = rooms; updateRoomListUI(); });

function updateRoomListUI() {
    const list = document.getElementById('roomList');
    list.innerHTML = `<div class="room-item ${currentRoomId === 'global' ? 'active' : ''}" onclick="joinRoom('global')">Salon Global</div>`;
    allRooms.forEach(room => {
        list.innerHTML += `<div class="room-item ${currentRoomId === room._id ? 'active' : ''}" onclick="joinRoom('${room._id}')">${room.name}</div>`;
    });
}

function openDm(target) {
    currentDmTarget = target; currentRoomId = null;
    if (!dmContacts.includes(target)) dmContacts.push(target);
    document.getElementById('currentRoomName').textContent = `@${target}`;
    document.getElementById('messages').innerHTML = "";
    socket.emit('request_dm_history', { myUsername: USERNAME, targetUsername: target });
    updateDmListUI(); switchView('chat'); 
}
function updateDmListUI() {
    const list = document.getElementById('dmList'); list.innerHTML = "";
    dmContacts.forEach(contact => {
        list.innerHTML += `<div class="dm-item ${currentDmTarget === contact ? 'active' : ''}" onclick="openDm('${contact}')"><span>${contact}</span></div>`;
    });
}
socket.on('dm_history_data', (data) => { if (currentDmTarget === data.target) { data.history.forEach(msg => displayMessage(msg, true)); } });
socket.on('receive_dm', (msg) => {
    const other = (msg.sender === USERNAME) ? msg.target : msg.sender;
    if (!dmContacts.includes(other)) { dmContacts.push(other); updateDmListUI(); }
    if (currentDmTarget === other) displayMessage(msg, true);
});

async function createCharacter() {
    const name = document.getElementById('newCharName').value.trim();
    const role = document.getElementById('newCharRole').value.trim();
    const file = document.getElementById('newCharFile').files[0];
    const avatar = file ? await uploadToCloudinary(file) : `https://ui-avatars.com/api/?name=${name}`;
    socket.emit('create_char', { name, role, avatar, color: document.getElementById('newCharColor').value, description: document.getElementById('newCharDesc').value.trim(), ownerId: PLAYER_ID });
    toggleCreateForm();
}

function selectCharacter(id) {
    currentSelectedChar = myCharacters.find(c => c._id === id);
    localStorage.setItem('saved_char_id', id);
    updateUI();
}

function updateUI() {
    const list = document.getElementById('myCharList');
    list.innerHTML = "";
    myCharacters.forEach(char => {
        list.innerHTML += `<div class="char-item" onclick="selectCharacter('${char._id}')">
            <img src="${char.avatar}" class="mini-avatar">
            <div class="char-info">
                <div class="char-name-list" style="color:${char.color}">${char.name}</div>
                <div class="char-role-list">${char.role}</div>
            </div>
        </div>`;
    });
    updateFeedCharUI();
}

function updateFeedCharUI() {
    const container = document.getElementById('feed-char-avatar-wrapper');
    if(!container) return;
    const char = myCharacters.find(c => c._id === currentFeedCharId) || myCharacters[0];
    if(!char) return;
    if(!currentFeedCharId) currentFeedCharId = char._id;

    container.innerHTML = `
        <div class="feed-char-trigger" onclick="toggleFeedCharDropdown()">
            <img src="${char.avatar}" class="feed-char-avatar-btn">
            <i class="fa-solid fa-chevron-down feed-char-chevron"></i>
        </div>
        <div id="feed-char-dropdown" class="feed-char-dropdown hidden">
            ${myCharacters.map(c => `
                <div class="feed-char-option ${c._id === currentFeedCharId ? 'active' : ''}" onclick="selectFeedChar('${c._id}')">
                    <img src="${c.avatar}" class="feed-char-opt-avatar">
                    <div>
                        <div class="feed-char-opt-name">${c.name}</div>
                        <div class="feed-char-opt-role">${c.role}</div>
                    </div>
                </div>`).join('')}
        </div>`;
}

function toggleFeedCharDropdown() { document.getElementById('feed-char-dropdown').classList.toggle('hidden'); }
function selectFeedChar(id) { currentFeedCharId = id; updateFeedCharUI(); }

socket.on('my_chars_data', (chars) => { myCharacters = chars; updateUI(); });

function displayMessage(msg, isDm = false) {
    const div = document.createElement('div');
    div.className = 'message-container'; 
    const senderName = isDm ? msg.sender : msg.senderName;
    const senderAvatar = isDm ? `https://ui-avatars.com/api/?name=${senderName}` : msg.senderAvatar;
    div.innerHTML = `
        <img src="${senderAvatar}" class="avatar-img">
        <div class="char-header">
            <span class="char-name" style="color:${msg.senderColor || '#fff'}">${senderName}</span>
            <span class="timestamp">${msg.date}</span>
        </div>
        <div class="text-body">${msg.content}</div>
    `;
    document.getElementById('messages').appendChild(div);
}

function loadFeed() { socket.emit('request_feed'); }
async function previewPostFile() { /* Logic for preview */ }
function submitPost() {
    const content = document.getElementById('postContent').value.trim();
    const mediaUrl = document.getElementById('postMediaUrl').value;
    const char = myCharacters.find(c => c._id === currentFeedCharId);
    if(!char) return;
    socket.emit('create_post', { 
        authorCharId: char._id, authorName: char.name, authorAvatar: char.avatar, authorRole: char.role, 
        content, mediaUrl, date: new Date().toLocaleDateString(), ownerId: PLAYER_ID,
        isBreakingNews: document.getElementById('postBreakingNews').checked,
        isAnonymous: document.getElementById('postAnonymous').checked
    });
    document.getElementById('postContent').value = "";
}

function createPostElement(post) {
    const div = document.createElement('div'); 
    div.className = 'post-card'; 
    const isArticle = post.content.length > 300 || post.isBreakingNews;
    if(isArticle) div.classList.add('post-article');

    let contentHTML = post.content;
    let titleHTML = "";
    if(isArticle) {
        const words = post.content.split(' ');
        const title = words.slice(0, 10).join(' ') + (words.length > 10 ? '...' : '');
        titleHTML = `<div class="post-article-title">${title}</div>`;
    }

    let mediaHTML = "";
    if(post.mediaUrl) {
        if(isArticle) {
            mediaHTML = `<img src="${post.mediaUrl}" class="post-banner">`;
        } else {
            mediaHTML = `<img src="${post.mediaUrl}" class="post-media">`;
        }
    }

    div.innerHTML = `
        ${isArticle ? mediaHTML : ''}
        <div class="post-article-body">
            <div class="post-header">
                <img src="${post.authorAvatar}" class="post-avatar">
                <div class="post-meta">
                    <div class="post-author">${post.authorName}</div>
                    <div class="post-role">${post.authorRole}</div>
                </div>
                <span class="post-date">${post.date}</span>
            </div>
            ${titleHTML}
            <div class="post-content">${contentHTML}</div>
            ${!isArticle ? mediaHTML : ''}
            <div class="post-actions">
                <button class="action-item" onclick="toggleLike('${post._id}')"><i class="fa-solid fa-heart"></i> ${post.likes.length}</button>
            </div>
        </div>
    `;
    return div;
}

socket.on('feed_data', (posts) => { 
    const c = document.getElementById('feed-stream'); 
    c.innerHTML = ""; 
    posts.forEach(p => c.appendChild(createPostElement(p))); 
});
socket.on('new_post', (post) => { document.getElementById('feed-stream').prepend(createPostElement(post)); });

function adminInjectVote(postId, optionIndex, count) {
    if(!IS_ADMIN) return;
    for(let i = 0; i < count; i++) {
        socket.emit('admin_inject_vote', { postId, optionIndex, fakeId: 'fake_' + Math.random() });
    }
}
