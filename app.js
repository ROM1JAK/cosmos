var socket = io();
const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/dllr3ugxz/auto/upload'; 
const CLOUDINARY_PRESET = 'Cosmos';

let myCharacters = [];
let allRooms = []; 
let currentRoomId = 'global'; 
let currentDmTarget = null; 
let PLAYER_ID, USERNAME, IS_ADMIN = false;
let currentContext = null; 
let currentSelectedChar = null; 
let currentView = 'chat';
let notificationsEnabled = true;

// Grouping logic
let lastMsgAuthorId = null; 
let lastMsgTime = 0;

// Media
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let stagedFiles = { chat: null, post: null, comment: null };

// --- STAGING & MEDIA ---
function triggerFileSelect(source) {
    const map = { 'chat': 'chatFileInput', 'post': 'postFileInput', 'comment': 'commentFileInput' };
    document.getElementById(map[source]).click();
}

function handleFileSelect(input, source) {
    const file = input.files[0];
    if(!file) return;
    let type = 'image';
    if(file.type.startsWith('video/')) type = 'video';
    stageContent(source, file, type);
    input.value = ""; 
}

function stageContent(source, fileOrBlob, type) {
    const url = URL.createObjectURL(fileOrBlob);
    stagedFiles[source] = { file: fileOrBlob, type: type, url: url };
    renderStaging(source);
}

function clearStaging(source = 'chat') {
    stagedFiles[source] = null;
    const map = { 'chat': 'chat-staging', 'post': 'post-staging', 'comment': 'comment-staging' };
    document.getElementById(map[source]).classList.add('hidden');
}
function clearPostStaging() { clearStaging('post'); }
function clearCommentStaging() { clearStaging('comment'); }

function renderStaging(source) {
    const data = stagedFiles[source];
    if(!data) return;
    let html = "";
    if(data.type === 'image') html = `<img src="${data.url}" class="staging-preview-img" style="max-height:60px;">`;
    else if(data.type === 'video') html = `<video src="${data.url}" style="max-height:60px; border-radius:4px;"></video>`;
    else if(data.type === 'audio') html = renderCustomAudio(data.url);

    if(source === 'chat') {
        document.getElementById('staging-content').innerHTML = html;
        document.getElementById('staging-filename').textContent = (data.type === 'audio' ? "Note vocale" : "Fichier média");
        document.getElementById('chat-staging').classList.remove('hidden');
    } else if (source === 'post') {
        document.getElementById('post-staging-content').innerHTML = html;
        document.getElementById('post-staging').classList.remove('hidden');
    } else if (source === 'comment') {
        document.getElementById('comment-staging-preview').innerHTML = html;
        document.getElementById('comment-staging').classList.remove('hidden');
    }
}

// Custom Audio
function renderCustomAudio(src) {
    const id = "audio-" + Math.random().toString(36).substr(2, 9);
    return `<div class="custom-audio-player">
        <button class="audio-btn" onclick="togglePlayAudio('${id}')"><i id="icon-${id}" class="fa-solid fa-play"></i></button>
        <div class="audio-progress-bar"><div id="bar-${id}" class="audio-progress-fill"></div></div>
        <audio id="${id}" src="${src}" ontimeupdate="updateAudioUI('${id}')" onended="resetAudioUI('${id}')"></audio>
    </div>`;
}
window.togglePlayAudio = function(id) {
    const audio = document.getElementById(id);
    const icon = document.getElementById(`icon-${id}`);
    if(audio.paused) { document.querySelectorAll('audio').forEach(a=>{if(a.id!==id){a.pause();resetAudioUI(a.id)}}); audio.play(); icon.className="fa-solid fa-pause"; }
    else { audio.pause(); icon.className="fa-solid fa-play"; }
};
window.updateAudioUI = function(id) {
    const a = document.getElementById(id), b = document.getElementById(`bar-${id}`);
    if(a && b) b.style.width = ((a.currentTime/a.duration)*100)+"%";
};
window.resetAudioUI = function(id) {
    const i = document.getElementById(`icon-${id}`), b = document.getElementById(`bar-${id}`);
    if(i) i.className="fa-solid fa-play"; if(b) b.style.width="0%";
};

async function uploadToCloudinary(file) {
    if(!file) return null;
    const fd = new FormData(); fd.append('file', file); fd.append('upload_preset', CLOUDINARY_PRESET);
    try { const r=await fetch(CLOUDINARY_URL,{method:'POST',body:fd}); const d=await r.json(); return d.secure_url; }
    catch(e){console.error(e);return null;}
}

// --- RECORDING ---
async function toggleRecording(source) {
    const btnId = `btn-record-${source}`;
    const btn = document.getElementById(btnId);
    if (!btn) return;

    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.start();
            isRecording = true;
            btn.classList.add('recording');
        } catch (err) { alert("Micro inaccessible"); }
    } else {
        mediaRecorder.stop();
        mediaRecorder.onstop = () => {
            const blob = new Blob(audioChunks, { type: 'audio/webm' });
            btn.classList.remove('recording');
            isRecording = false;
            stageContent(source, blob, 'audio');
        };
    }
}

// --- STANDARD APP LOGIC (RESTORED) ---
function switchView(view) {
    currentView = view;
    document.querySelectorAll('.view-section').forEach(el => { el.classList.remove('active'); el.classList.add('hidden'); });
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.remove('hidden');
    document.getElementById(`view-${view}`).classList.add('active');
    document.getElementById(`btn-view-${view}`).classList.add('active');
}

function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('mobile-overlay').classList.toggle('open'); }
function toggleCreateForm() { document.getElementById('create-char-form').classList.toggle('hidden'); }
function toggleCharBar() { 
    const bar = document.getElementById('char-bar-horizontal');
    const icon = document.getElementById('toggle-icon');
    bar.classList.toggle('hidden-bar');
    icon.className = bar.classList.contains('hidden-bar') ? "fa-solid fa-chevron-up" : "fa-solid fa-chevron-down";
}

function openAccountUI() { document.getElementById('user-settings-modal').classList.remove('hidden'); }
function closeUserSettingsModal() { document.getElementById('user-settings-modal').classList.add('hidden'); }
function openLoginModal() { document.getElementById('login-modal').classList.remove('hidden'); }
function closeLoginModal() { document.getElementById('login-modal').classList.add('hidden'); }
function submitLogin() {
    const pseudo = document.getElementById('loginPseudoInput').value.trim();
    const code = document.getElementById('loginCodeInput').value.trim();
    if(pseudo && code) socket.emit('login_request', { username: pseudo, code });
}
function logoutUser() { localStorage.clear(); location.reload(); }
function toggleSecretVisibility() {
    const input = document.getElementById('settingsCodeInput');
    input.type = input.type === "password" ? "text" : "password";
}

function createCharacter() {
    const name = document.getElementById('newCharName').value.trim();
    const role = document.getElementById('newCharRole').value.trim();
    const desc = document.getElementById('newCharDesc').value.trim();
    const color = document.getElementById('newCharColor').value;
    const file = document.getElementById('newCharFile').files[0];
    
    if(!name || !role) return alert("Nom/Rôle requis");
    
    if(file) uploadToCloudinary(file).then(url => emitChar(name, role, desc, color, url));
    else emitChar(name, role, desc, color, `https://ui-avatars.com/api/?name=${name}`);
}
function emitChar(name, role, description, color, avatar) {
    socket.emit('create_char', { name, role, description, color, avatar, ownerId: PLAYER_ID });
    toggleCreateForm();
}
function previewFile(mode) {
    // vide mais nécessaire pour l'attribut onchange HTML
}

// SOCKET
socket.on('login_success', (data) => {
    USERNAME = data.username; PLAYER_ID = data.userId; IS_ADMIN = data.isAdmin;
    localStorage.setItem('rp_username', USERNAME); localStorage.setItem('rp_code', PLAYER_ID);
    closeLoginModal();
    document.getElementById('player-id-display').textContent = USERNAME;
    socket.emit('request_initial_data', PLAYER_ID);
    joinRoom('global');
});
socket.on('connect', () => {
    const u = localStorage.getItem('rp_username'), c = localStorage.getItem('rp_code');
    if(u && c) socket.emit('login_request', { username: u, code: c });
    else openLoginModal();
});
socket.on('rooms_data', (r) => { 
    allRooms = r; 
    const list = document.getElementById('roomList');
    list.innerHTML = `<div class="room-item ${(currentRoomId==='global'&&!currentDmTarget)?'active':''}" onclick="joinRoom('global')"><span class="room-name">Global</span></div>`;
    allRooms.forEach(room => {
        list.innerHTML += `<div class="room-item ${(currentRoomId===room._id)?'active':''}" onclick="joinRoom('${room._id}')"><span class="room-name">${room.name}</span></div>`;
    });
});
socket.on('update_user_list', (users) => {
    document.getElementById('online-count').textContent = users.length;
    document.getElementById('online-users-list').innerHTML = users.map(u=>`<div class="online-user" onclick="openDm('${u}')"><span class="status-dot"></span>${u}</div>`).join('');
});
socket.on('my_chars_data', (chars) => {
    myCharacters = chars;
    const list = document.getElementById('myCharList');
    const bar = document.getElementById('char-bar-horizontal');
    const sel = document.getElementById('feedCharSelector');
    list.innerHTML = ""; bar.innerHTML = ""; sel.innerHTML = "";
    
    if(IS_ADMIN) {
        bar.innerHTML += `<img src="https://cdn-icons-png.flaticon.com/512/1144/1144760.png" class="avatar-choice" onclick="selectCharacter('narrateur')" id="avatar-opt-narrateur">`;
        sel.innerHTML += `<option value="Narrateur" data-avatar="https://cdn-icons-png.flaticon.com/512/1144/1144760.png">Narrateur</option>`;
    }
    chars.forEach(c => {
        list.innerHTML += `<div class="char-item"><img src="${c.avatar}" class="mini-avatar"><div class="char-info"><div class="char-name-list" style="color:${c.color}">${c.name}</div></div></div>`;
        bar.innerHTML += `<img src="${c.avatar}" class="avatar-choice" onclick="selectCharacter('${c._id}')" id="avatar-opt-${c._id}">`;
        sel.innerHTML += `<option value="${c.name}" data-id="${c._id}" data-avatar="${c.avatar}">${c.name}</option>`;
    });
});

function selectCharacter(id) {
    if(id === 'narrateur') currentSelectedChar = { name: 'Narrateur', role: 'Omniscient', color: '#fff', avatar: 'https://cdn-icons-png.flaticon.com/512/1144/1144760.png' };
    else currentSelectedChar = myCharacters.find(c => c._id === id);
    document.querySelectorAll('.avatar-choice').forEach(el => el.classList.remove('selected'));
    const el = document.getElementById(`avatar-opt-${id}`);
    if(el) el.classList.add('selected');
}

// CHAT
async function sendMessage() {
    const txt = document.getElementById('txtInput').value.trim();
    const staged = stagedFiles['chat'];
    if(!txt && !staged) return;

    let content = txt, type = 'text';
    if(staged) {
        const url = await uploadToCloudinary(staged.file);
        if(!url) return;
        content = url; type = staged.type;
        // Si texte + fichier, on envoie d'abord le fichier
        if(txt) {
             sendMsgInternal(content, type);
             content = txt; type = 'text';
        }
    }
    sendMsgInternal(content, type);
    document.getElementById('txtInput').value = "";
    clearStaging('chat');
    cancelContext();
}

function sendMsgInternal(content, type) {
    const data = {
        content, type, date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
        ownerId: PLAYER_ID,
        replyTo: currentContext?.data
    };
    if(currentDmTarget) {
        socket.emit('send_dm', { ...data, sender: USERNAME, target: currentDmTarget });
    } else {
        if(!currentSelectedChar) return alert("Perso requis");
        socket.emit('message_rp', { ...data, roomId: currentRoomId, senderName: currentSelectedChar.name, senderAvatar: currentSelectedChar.avatar, senderRole: currentSelectedChar.role, senderColor: currentSelectedChar.color });
    }
}

function joinRoom(id) {
    if(currentRoomId !== id) { socket.emit('leave_room', currentRoomId); lastMsgAuthorId = null; }
    currentRoomId = id; currentDmTarget = null;
    socket.emit('join_room', id);
    socket.emit('request_history', id);
    document.getElementById('messages').innerHTML = "";
    document.getElementById('currentRoomName').textContent = id === 'global' ? 'Salon Global' : 'Salon';
    document.getElementById('char-selector-wrapper').classList.remove('hidden');
    document.getElementById('dm-header-actions').classList.add('hidden');
}

function openDm(target) {
    currentDmTarget = target;
    document.getElementById('messages').innerHTML = "";
    document.getElementById('currentRoomName').textContent = `@${target}`;
    document.getElementById('char-selector-wrapper').classList.add('hidden');
    document.getElementById('dm-header-actions').classList.remove('hidden');
    socket.emit('request_dm_history', { myUsername: USERNAME, targetUsername: target });
    lastMsgAuthorId = null;
}
function closeCurrentDm() { joinRoom('global'); }

// DISPLAY MSG
function displayMessage(msg) {
    const container = document.getElementById('messages');
    const msgTime = new Date(msg.timestamp).getTime();
    
    // Grouping
    const isSameAuthor = (msg.ownerId === lastMsgAuthorId);
    const isRecent = (msgTime - lastMsgTime) < 120000;
    const isGrouped = isSameAuthor && isRecent && !msg.replyTo && msg.type === 'text';

    const div = document.createElement('div');
    div.className = 'message-container';
    if(isGrouped) div.classList.add('msg-group-followup');
    div.id = `msg-${msg._id}`;

    let contentHTML = "";
    if (msg.type === 'image') contentHTML = `<img src="${msg.content}" class="chat-image" onclick="window.open(this.src)">`;
    else if (msg.type === 'video') contentHTML = `<video src="${msg.content}" class="video-direct" controls></video>`;
    else if (msg.type === 'audio') contentHTML = renderCustomAudio(msg.content);
    else contentHTML = `<div class="text-body">${formatText(msg.content)}</div>`;

    const senderName = msg.senderName || msg.sender;
    const avatar = msg.senderAvatar || `https://ui-avatars.com/api/?name=${senderName}`;

    let replyHTML = "";
    if(msg.replyTo) replyHTML = `<div class="reply-context-line" style="margin-left: 55px;"><span class="reply-name">@${msg.replyTo.author}</span></div>`;

    div.innerHTML = `
        <div class="msg-actions">
            <button class="action-btn" onclick="triggerReply('${msg._id}', '${senderName}', '${msg.content}')"><i class="fa-solid fa-reply"></i></button>
            ${(msg.ownerId === PLAYER_ID || IS_ADMIN) ? `<button class="action-btn" onclick="socket.emit('delete_message', '${msg._id}')" style="color:#da373c;"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>
        ${replyHTML}
        <img src="${avatar}" class="avatar-img" onclick="openProfile('${senderName}')">
        <div style="margin-left: 55px;">
            <div class="char-header">
                <span class="char-name" style="color:${msg.senderColor||'white'}" onclick="openProfile('${senderName}')">${senderName}</span>
                <span class="timestamp">${msg.date}</span>
            </div>
            ${contentHTML}
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    
    lastMsgAuthorId = msg.ownerId;
    lastMsgTime = msgTime;
}

socket.on('history_data', (msgs) => { document.getElementById('messages').innerHTML = ""; lastMsgAuthorId=null; msgs.forEach(m => displayMessage(m)); });
socket.on('message_rp', (msg) => { if(msg.roomId === currentRoomId && !currentDmTarget) displayMessage(msg); });
socket.on('receive_dm', (msg) => { if(currentDmTarget === (msg.sender===USERNAME?msg.target:msg.sender)) displayMessage(msg); else { /* notif DM */ } });
socket.on('dm_history_data', (d) => { if(currentDmTarget===d.target) { d.history.forEach(m=>displayMessage(m)); }});
socket.on('message_deleted', (id) => { const el=document.getElementById(`msg-${id}`); if(el) el.remove(); });

// POSTS
function submitPost() {
    const txt = document.getElementById('postContent').value.trim();
    const staged = stagedFiles['post'];
    if(!txt && !staged) return;
    
    if(staged) {
        uploadToCloudinary(staged.file).then(url => emitPost(txt, url, staged.type));
    } else emitPost(txt, null, null);
    clearPostStaging();
}
function emitPost(content, mediaUrl, mediaType) {
    const sel = document.getElementById('feedCharSelector');
    const opt = sel.options[sel.selectedIndex];
    socket.emit('create_post', { content, mediaUrl, mediaType, authorName: opt.value, authorAvatar: opt.dataset.avatar, authorRole: "RP", ownerId: PLAYER_ID, date: new Date().toLocaleDateString() });
    document.getElementById('postContent').value = "";
}

// Feed rendering
socket.on('feed_data', (posts) => { const s=document.getElementById('feed-stream'); s.innerHTML=""; posts.forEach(p=>s.appendChild(createPostEl(p))); });
socket.on('new_post', (p) => document.getElementById('feed-stream').prepend(createPostEl(p)));
socket.on('post_updated', (p) => { const el=document.getElementById(`post-${p._id}`); if(el) el.replaceWith(createPostEl(p)); });

function createPostEl(post) {
    const d = document.createElement('div'); d.className='post-card'; d.id=`post-${post._id}`;
    let media = "";
    if(post.mediaUrl) {
        if(post.mediaType==='video') media = `<video src="${post.mediaUrl}" controls class="post-media"></video>`;
        else if(post.mediaType==='audio') media = renderCustomAudio(post.mediaUrl);
        else media = `<img src="${post.mediaUrl}" class="post-media">`;
    }
    d.innerHTML = `
        <div class="post-header" onclick="openProfile('${post.authorName}')">
            <img src="${post.authorAvatar}" class="post-avatar">
            <div><div class="post-author">${post.authorName}</div><div class="post-date">${post.date}</div></div>
        </div>
        <div class="post-content" onclick="openPostDetail('${post._id}')">${formatText(post.content)}</div>
        ${media}
        <div class="post-actions">
            <button class="action-item" onclick="socket.emit('like_post', {postId:'${post._id}', userId:PLAYER_ID})"><i class="fa-solid fa-heart"></i> ${post.likes.length}</button>
            <button class="action-item" onclick="openPostDetail('${post._id}')"><i class="fa-solid fa-comment"></i> ${post.comments.length}</button>
        </div>
    `;
    return d;
}

// Helpers
function triggerReply(id, auth, txt) { currentContext={data:{id,author:auth}}; document.getElementById('context-bar').classList.remove('hidden'); document.getElementById('context-text').textContent=`Réponse à ${auth}`; }
function cancelContext() { currentContext=null; document.getElementById('context-bar').classList.add('hidden'); }
function formatText(t) { return t ? t.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') : ""; }
function openPostDetail(id) { document.getElementById('post-detail-modal').classList.remove('hidden'); } // Simplifié

// Notifs
socket.on('notifications_data', (list) => {
    const c = document.getElementById('notif-modal-content'); c.innerHTML="";
    let unread=0;
    list.forEach(n=>{ if(!n.read) unread++; c.innerHTML+=`<div class="notif-item ${!n.read?'unread':''}">${n.content}</div>`; });
    const b = document.getElementById('notif-badge'); b.textContent=unread; b.classList.toggle('visible', unread>0);
});
function openNotifications() { document.getElementById('notifications-modal').classList.remove('hidden'); }
function closeNotifications() { document.getElementById('notifications-modal').classList.add('hidden'); }
function markNotificationsRead() { socket.emit('mark_notifications_read', PLAYER_ID); }

// Follow
function toggleFollow() { /* logique follow simplifiée */ }
