// app.js
const socket = io();

// --- CONFIG CLOUDINARY ---
const CLOUD_NAME = 'https://api.cloudinary.com/v1_1/dllr3ugxz/auto/upload'; // REMPLACE PAR TON CLOUD NAME
const UPLOAD_PRESET = 'Cosmos'; // REMPLACE PAR TON PRESET

// --- STATE ---
let currentUser = null;
let currentRoom = 'Général';
let myChars = [];
let selectedCharId = null;
let privateTarget = null; // { id, name }
let replyTarget = null; // messageId
let mediaStaged = null; // File object
let mediaRecorder = null;
let audioChunks = [];
let lastViewedTimes = JSON.parse(localStorage.getItem('rp_last_viewed')) || {};

// --- AUTH ---
const savedUser = JSON.parse(localStorage.getItem('rp_user'));
if (savedUser) {
    document.getElementById('loginPseudo').value = savedUser.pseudo;
    document.getElementById('loginCode').value = savedUser.code;
    login();
}

function login() {
    const pseudo = document.getElementById('loginPseudo').value;
    const code = document.getElementById('loginCode').value;
    if (!pseudo || !code) return alert('Champs requis');
    socket.emit('login', { pseudo, code });
}

function logout() {
    localStorage.removeItem('rp_user');
    location.reload();
}

// --- SOCKET LISTENERS ---
socket.on('login_success', (user) => {
    currentUser = user;
    localStorage.setItem('rp_user', JSON.stringify({ pseudo: user.pseudo, code: document.getElementById('loginCode').value }));
    document.getElementById('loginModal').classList.remove('active');
    document.getElementById('app').style.display = 'grid';
    document.getElementById('myPseudo').innerText = user.pseudo;
    
    // Admin features
    if(user.isAdmin) {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'inline-block');
    } else {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    }
    
    socket.emit('join_room', 'Général');
});

socket.on('login_error', (msg) => alert(msg));

socket.on('room_list', (rooms) => {
    const list = document.getElementById('roomList');
    list.innerHTML = '';
    rooms.forEach(r => {
        const li = document.createElement('li');
        li.innerHTML = `# ${r.name} ${currentUser.isAdmin ? `<i class="fas fa-trash" onclick="deleteRoom('${r._id}')" style="margin-left:auto;font-size:10px;color:red"></i>` : ''}`;
        li.onclick = (e) => { if(e.target.tagName !== 'I') joinRoom(r.name); };
        if(r.name === currentRoom) li.classList.add('active');
        // Unread logic could go here
        list.appendChild(li);
    });
});

socket.on('update_users', (users) => {
    const list = document.getElementById('userList');
    list.innerHTML = users.map(u => `
        <li onclick="startDM('${u.userId}', '${u.pseudo}')">
            <i class="fas fa-circle" style="color:${u.online?'var(--success)':'gray'};font-size:8px;"></i> ${u.pseudo}
        </li>`).join('');
});

socket.on('my_chars', (chars) => {
    myChars = chars;
    renderCharList();
    renderCharSelector();
});

// --- CHAT LOGIC ---
function joinRoom(name) {
    currentRoom = name;
    lastViewedTimes[name] = Date.now(); // Mark as read on enter
    localStorage.setItem('rp_last_viewed', JSON.stringify(lastViewedTimes));
    socket.emit('join_room', name);
    document.getElementById('currentRoomTitle').innerText = '# ' + name;
}

socket.on('load_messages', ({ room, messages }) => {
    const container = document.getElementById('chatMessages');
    container.innerHTML = '';
    let lastUser = null;
    
    // New messages separator logic
    let separatorDrawn = false;
    const lastRead = lastViewedTimes[room] || 0;

    messages.forEach(msg => {
        if (!separatorDrawn && new Date(msg.timestamp).getTime() > lastRead) {
            const div = document.createElement('div');
            div.className = 'new-messages-bar';
            div.innerHTML = '<span>Nouveaux Messages</span>';
            container.appendChild(div);
            separatorDrawn = true;
        }
        renderMessage(msg, container, lastUser === msg.character.name);
        lastUser = msg.character.name;
    });
    scrollToBottom();
    
    // Update last viewed
    lastViewedTimes[room] = Date.now();
    localStorage.setItem('rp_last_viewed', JSON.stringify(lastViewedTimes));
});

socket.on('new_message', (msg) => {
    if ((msg.roomId === currentRoom) || (msg.isPrivate && (msg.targetId === currentUser.userId || msg.character.userId === currentUser.userId))) {
        renderMessage(msg, document.getElementById('chatMessages'));
        scrollToBottom();
    } else {
        // Notification in room list (simple logic)
        const roomItems = document.querySelectorAll('#roomList li');
        roomItems.forEach(li => {
            if(li.innerText.includes(msg.roomId)) li.classList.add('unread');
        });
    }
});

function renderMessage(msg, container, isGrouped = false) {
    const div = document.createElement('div');
    div.className = `message ${msg.isPrivate ? 'private-msg' : ''}`;
    
    // Markdown
    let contentHtml = marked.parse(msg.content || '');
    // Spoiler
    contentHtml = contentHtml.replace(/\|\|(.*?)\|\|/g, '<span class="spoiler" onclick="this.classList.remove(\'spoiler\')">$1</span>');

    let mediaHtml = '';
    if (msg.media) {
        if (msg.media.type.startsWith('image')) mediaHtml = `<img src="${msg.media.url}">`;
        else if (msg.media.type.startsWith('video')) mediaHtml = `<video src="${msg.media.url}" controls></video>`;
        else if (msg.media.type.startsWith('audio')) mediaHtml = `<audio src="${msg.media.url}" controls></audio>`;
    }

    const header = isGrouped ? '' : `
        <div class="msg-header">
            <img src="${msg.character.avatar}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;border:2px solid ${msg.character.color}" onclick="viewProfile('${msg.character.id}')">
            <span class="char-name" style="color:${msg.character.color}" onclick="viewProfile('${msg.character.id}')">${msg.character.name}</span>
            <span class="timestamp">${new Date(msg.timestamp).toLocaleTimeString()}</span>
             ${msg.isPrivate ? '<i class="fas fa-lock" title="Privé"></i>' : ''}
        </div>`;

    div.innerHTML = `
        ${header}
        <div class="msg-content" style="margin-left:${isGrouped?38:0}px">
            ${contentHtml}
            ${mediaHtml}
        </div>
        <div class="msg-actions">
            ${currentUser.isAdmin ? `<i class="fas fa-trash" onclick="deleteMessage('${msg._id}')"></i>` : ''}
            <i class="fas fa-envelope" onclick="startDM('${msg.character.userId}', '${msg.character.name} (User)')"></i>
        </div>
    `;
    container.appendChild(div);
}

socket.on('message_deleted', ({id}) => {
    // Reload room is simplest to remove from UI properly
    socket.emit('join_room', currentRoom);
});

// --- INPUT & SEND ---
async function sendMessage() {
    if (!selectedCharId && !privateTarget) return alert('Choisis un personnage !');
    const input = document.getElementById('msgInput');
    const content = input.value;
    
    if (!content.trim() && !mediaStaged) return;

    let mediaData = null;
    if (mediaStaged) {
        const url = await uploadToCloudinary(mediaStaged);
        mediaData = { type: mediaStaged.type, url };
        resetMediaStage();
    }

    socket.emit('send_message', {
        roomId: currentRoom,
        charId: selectedCharId,
        content: content,
        media: mediaData,
        replyTo: replyTarget,
        isPrivate: !!privateTarget,
        targetId: privateTarget ? privateTarget.id : null
    });

    input.value = '';
    clearContext();
}

// --- CLOUDINARY & MEDIA ---
async function uploadToCloudinary(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    
    // NOTE: Pour audio/video, changer 'image' en 'video' ou 'auto' dans l'URL si besoin
    const resourceType = file.type.includes('image') ? 'image' : 'video'; 
    
    try {
        const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        return data.secure_url;
    } catch (e) {
        console.error(e);
        alert('Upload failed');
        return null;
    }
}

function handleFileSelect(input) {
    if(input.files && input.files[0]) {
        mediaStaged = input.files[0];
        document.getElementById('mediaPreview').innerHTML = `<span>${mediaStaged.name}</span> <i class="fas fa-times" onclick="resetMediaStage()"></i>`;
    }
}

function resetMediaStage() {
    mediaStaged = null;
    document.getElementById('mediaPreview').innerHTML = '';
    document.getElementById('mediaInput').value = '';
}

// --- AUDIO RECORDING ---
function toggleRecord() {
    const btn = document.getElementById('btnRecord');
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        btn.style.color = 'inherit';
    } else {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            mediaRecorder = new MediaRecorder(stream);
            mediaRecorder.start();
            btn.style.color = 'red';
            audioChunks = [];
            
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' });
                mediaStaged = new File([audioBlob], 'voice_message.mp3', { type: 'audio/mp3' });
                document.getElementById('mediaPreview').innerHTML = `<span>Audio enregistré</span> <i class="fas fa-times" onclick="resetMediaStage()"></i>`;
            };
        });
    }
}

// --- CHARACTERS ---
function saveCharacter() {
    const name = document.getElementById('charName').value;
    const role = document.getElementById('charRole').value;
    const color = document.getElementById('charColor').value;
    const bio = document.getElementById('charBio').value;
    const file = document.getElementById('charAvatarFile').files[0];

    if(!name || !file) return alert('Nom et Avatar requis');

    uploadToCloudinary(file).then(url => {
        socket.emit('create_char', { name, role, color, bio, avatar: url });
        closeModal('charModal');
    });
}

function renderCharList() {
    const list = document.getElementById('myCharList');
    list.innerHTML = myChars.map(c => `
        <div class="char-card" style="display:flex;align-items:center;gap:10px;padding:5px;">
            <img src="${c.avatar}" style="width:30px;height:30px;border-radius:50%">
            <span>${c.name}</span>
        </div>
    `).join('');
}

function renderCharSelector() {
    const bar = document.getElementById('charSelectorBar');
    bar.innerHTML = myChars.map(c => `
        <img src="${c.avatar}" class="mini-char ${selectedCharId === c._id ? 'selected' : ''}" 
        onclick="selectChar('${c._id}')" title="${c.name}">
    `).join('');
    // Auto select first
    if(!selectedCharId && myChars.length > 0) selectChar(myChars[0]._id);
}

function selectChar(id) {
    selectedCharId = id;
    renderCharSelector();
}

function toggleCharBar() {
    const bar = document.getElementById('charSelectorBar');
    bar.style.display = bar.style.display === 'none' ? 'flex' : 'none';
}

// --- DMS ---
function startDM(userId, pseudo) {
    privateTarget = { id: userId, name: pseudo };
    document.getElementById('contextBar').classList.remove('hidden');
    document.getElementById('contextText').innerText = `Message privé pour ${pseudo}`;
}

function clearContext() {
    privateTarget = null;
    document.getElementById('contextBar').classList.add('hidden');
}

// --- FEED & MODALS & UTILS ---
function switchTab(tab) {
    if(tab === 'chat') {
        document.getElementById('chatView').classList.remove('hidden');
        document.getElementById('feedView').classList.add('hidden');
    } else {
        document.getElementById('chatView').classList.add('hidden');
        document.getElementById('feedView').classList.remove('hidden');
        socket.emit('get_feed');
    }
}

socket.on('feed_data', (posts) => {
    const container = document.getElementById('feedContent');
    container.innerHTML = posts.map(p => `
        <div class="post-card">
            <div class="post-header">
                <img src="${p.character.avatar}" class="post-avatar">
                <div>
                    <strong>${p.character.name}</strong>
                    <div style="font-size:0.8em;color:gray">${new Date(p.timestamp).toLocaleString()}</div>
                </div>
            </div>
            <div class="post-body">${marked.parse(p.content || '')}</div>
            ${p.media ? `<img src="${p.media.url}" style="max-width:100%;margin-top:10px;border-radius:8px;">` : ''}
            <div class="post-actions">
                <span onclick="socket.emit('like_post', {postId:'${p._id}', charId: selectedCharId})">
                    <i class="fas fa-heart ${p.likes.includes(selectedCharId)?'liked':''}"></i> ${p.likes.length}
                </span>
                <span><i class="fas fa-comment"></i> ${p.comments.length}</span>
            </div>
        </div>
    `).join('');
});

// UI Helpers
function openCharModal() { document.getElementById('charModal').classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function createRoomPrompt() { const n = prompt('Nom du salon?'); if(n) socket.emit('create_room', n); }
function deleteRoom(id) { if(confirm('Supprimer?')) socket.emit('delete_room', id); }
function scrollToBottom() { const d = document.getElementById('chatMessages'); d.scrollTop = d.scrollHeight; }

function viewProfile(charId) {
    socket.emit('get_char_details', charId);
}
socket.on('char_details', ({char, playedBy}) => {
    document.getElementById('viewAvatar').src = char.avatar;
    document.getElementById('viewName').innerText = char.name;
    document.getElementById('viewRole').innerText = char.role;
    document.getElementById('viewPlayer').innerText = playedBy;
    document.getElementById('viewBio').innerText = char.bio;
    document.getElementById('profileModal').classList.add('active');
});

// Key events
function checkEnter(e) {
    if(e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}
function emitTyping() {
    socket.emit('typing', { room: currentRoom, user: currentUser.pseudo });
}

