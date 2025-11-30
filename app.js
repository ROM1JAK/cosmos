var socket = io();
const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/dllr3ugxz/auto/upload'; 
const CLOUDINARY_PRESET = 'Cosmos';

// ETAT GLOBAL
let myCharacters = [];
let allRooms = []; 
let currentRoomId = 'global'; 
let currentDmTarget = null; 
let PLAYER_ID, USERNAME, IS_ADMIN = false;
let currentContext = null; 
let currentSelectedChar = null; 
let currentView = 'chat';

// Gestion Messages
let lastMsgAuthorId = null; 
let lastMsgTime = 0;

// Gestion Audio/Staging
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let stagedFiles = {
    chat: null, // { file: Blob/File, type: 'image'|'video'|'audio', url: string (preview) }
    post: null,
    comment: null
};

// --- NAVIGATION & NOTIFS ---
function switchView(view) {
    currentView = view;
    document.querySelectorAll('.view-section').forEach(el => { el.classList.remove('active'); el.classList.add('hidden'); });
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.remove('hidden');
    document.getElementById(`view-${view}`).classList.add('active');
    document.getElementById(`btn-view-${view}`).classList.add('active');
    if(view === 'feed') loadFeed();
}

// --- CLOUDINARY UPLOAD ---
async function uploadToCloudinary(file) {
    if (!file) return null;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_PRESET);
    try {
        const res = await fetch(CLOUDINARY_URL, { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Err Upload');
        const data = await res.json();
        return data.secure_url; 
    } catch (e) { console.error(e); alert("Erreur envoi média"); return null; }
}

// --- LOGIQUE STAGING (Prévisualisation) ---
function triggerFileSelect(source) {
    const inputId = source === 'chat' ? 'chatFileInput' : (source === 'post' ? 'postFileInput' : 'commentFileInput');
    document.getElementById(inputId).click();
}

function handleFileSelect(input, source) {
    const file = input.files[0];
    if(!file) return;
    
    let type = 'image';
    if(file.type.startsWith('video/')) type = 'video';
    
    stageContent(source, file, type);
    input.value = ""; // Reset pour permettre de resélectionner le même fichier
}

function stageContent(source, fileOrBlob, type) {
    const url = URL.createObjectURL(fileOrBlob);
    stagedFiles[source] = { file: fileOrBlob, type: type, url: url };
    
    renderStaging(source);
}

function clearStaging(source = 'chat') {
    stagedFiles[source] = null;
    if(source === 'chat') document.getElementById('chat-staging').classList.add('hidden');
    if(source === 'post') document.getElementById('post-staging').classList.add('hidden');
    if(source === 'comment') document.getElementById('comment-staging').classList.add('hidden');
}

function clearPostStaging() { clearStaging('post'); }
function clearCommentStaging() { clearStaging('comment'); }

function renderStaging(source) {
    const data = stagedFiles[source];
    if(!data) return;

    let html = "";
    if(data.type === 'image') html = `<img src="${data.url}" class="staging-preview-img" style="max-height:60px;">`;
    else if(data.type === 'video') html = `<video src="${data.url}" style="max-height:60px; border-radius:4px;"></video>`;
    else if(data.type === 'audio') html = renderCustomAudio(data.url, false); // Audio player simple

    if(source === 'chat') {
        const container = document.getElementById('chat-staging');
        document.getElementById('staging-content').innerHTML = html;
        document.getElementById('staging-filename').textContent = (data.type === 'audio') ? "Note vocale" : "Fichier média";
        container.classList.remove('hidden');
    } 
    else if (source === 'post') {
        document.getElementById('post-staging-content').innerHTML = html;
        document.getElementById('post-staging').classList.remove('hidden');
    }
    else if (source === 'comment') {
        document.getElementById('comment-staging-preview').innerHTML = html;
        document.getElementById('comment-staging').classList.remove('hidden');
    }
}

// --- CUSTOM AUDIO PLAYER HTML ---
function renderCustomAudio(src, controls=true) {
    const id = "audio-" + Math.random().toString(36).substr(2, 9);
    // On utilise onclick="toggleAudio(this)" défini globalement
    return `
    <div class="custom-audio-player">
        <button class="audio-btn" onclick="togglePlayAudio('${id}')"><i id="icon-${id}" class="fa-solid fa-play"></i></button>
        <div class="audio-progress-bar"><div id="bar-${id}" class="audio-progress-fill"></div></div>
        <audio id="${id}" src="${src}" ontimeupdate="updateAudioUI('${id}')" onended="resetAudioUI('${id}')"></audio>
    </div>`;
}

// Helpers Audio Globaux
window.togglePlayAudio = function(id) {
    const audio = document.getElementById(id);
    const icon = document.getElementById(`icon-${id}`);
    if(audio.paused) { 
        document.querySelectorAll('audio').forEach(a => { if(a.id !== id) { a.pause(); resetAudioUI(a.id); } }); // Stop autres
        audio.play(); icon.className = "fa-solid fa-pause"; 
    }
    else { audio.pause(); icon.className = "fa-solid fa-play"; }
};
window.updateAudioUI = function(id) {
    const audio = document.getElementById(id);
    const bar = document.getElementById(`bar-${id}`);
    if(audio && bar) {
        const pct = (audio.currentTime / audio.duration) * 100;
        bar.style.width = pct + "%";
    }
};
window.resetAudioUI = function(id) {
    const icon = document.getElementById(`icon-${id}`);
    const bar = document.getElementById(`bar-${id}`);
    if(icon) icon.className = "fa-solid fa-play";
    if(bar) bar.style.width = "0%";
};

// --- ENREGISTREMENT VOCAL ---
async function toggleRecording(source) {
    const btnId = `btn-record-${source}`;
    const btn = document.getElementById(btnId);
    if (!btn) return console.error("Bouton micro introuvable:", btnId); // Correction Bug Micro

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

// --- LOGIN & SOCKET INIT ---
function checkAutoLogin() {
    const savedUser = localStorage.getItem('rp_username');
    const savedCode = localStorage.getItem('rp_code');
    if (savedUser && savedCode) socket.emit('login_request', { username: savedUser, code: savedCode });
    else openLoginModal();
}
function submitLogin() {
    const pseudo = document.getElementById('loginPseudoInput').value.trim();
    const code = document.getElementById('loginCodeInput').value.trim();
    if(pseudo && code) socket.emit('login_request', { username: pseudo, code });
}
function openLoginModal() { document.getElementById('login-modal').classList.remove('hidden'); }
function logoutUser() {
    if(confirm("Déconnexion ?")) {
        localStorage.clear(); location.reload();
    }
}

socket.on('connect', checkAutoLogin);
socket.on('login_success', (data) => {
    USERNAME = data.username; PLAYER_ID = data.userId; IS_ADMIN = data.isAdmin;
    localStorage.setItem('rp_username', USERNAME); localStorage.setItem('rp_code', PLAYER_ID);
    document.getElementById('login-modal').classList.add('hidden');
    document.getElementById('player-id-display').textContent = USERNAME;
    
    socket.emit('request_initial_data', PLAYER_ID);
    joinRoom('global');
});

// --- CHAT LOGIC ---
async function sendMessage() {
    const txtInput = document.getElementById('txtInput');
    const contentText = txtInput.value.trim();
    const staged = stagedFiles['chat'];

    if (!contentText && !staged) return;

    let finalContent = contentText;
    let msgType = 'text';

    if (staged) {
        // Upload
        const url = await uploadToCloudinary(staged.file);
        if (!url) return;
        finalContent = url; 
        msgType = staged.type;
        if(contentText) {
            // Si texte + média, on envoie d'abord le média, puis le texte (simplification)
            // Ou on pourrait modifier le schéma pour supporter les deux. 
            // Ici : on envoie le média, et si texte, on envoie un 2eme msg.
        }
    }

    const msgData = {
        roomId: currentDmTarget ? 'dm' : currentRoomId,
        content: finalContent,
        type: msgType,
        senderName: currentDmTarget ? USERNAME : currentSelectedChar?.name,
        senderAvatar: currentDmTarget ? null : currentSelectedChar?.avatar,
        senderRole: currentDmTarget ? null : currentSelectedChar?.role,
        senderColor: currentDmTarget ? null : currentSelectedChar?.color,
        ownerId: PLAYER_ID,
        targetName: currentDmTarget || "",
        date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
        replyTo: currentContext && currentContext.type === 'reply' ? currentContext.data : null
    };

    if(currentDmTarget) {
        msgData.sender = USERNAME; msgData.target = currentDmTarget;
        socket.emit('send_dm', msgData);
    } else {
        if(!currentSelectedChar) return alert("Sélectionnez un personnage.");
        socket.emit('message_rp', msgData);
    }

    // Cleanup
    txtInput.value = "";
    clearStaging('chat');
    cancelContext();
    
    // Si texte accompagnant le média (cas où contentText n'est pas vide et type != text)
    if(staged && contentText) {
        msgData.content = contentText; msgData.type = 'text';
        if(currentDmTarget) socket.emit('send_dm', msgData);
        else socket.emit('message_rp', msgData);
    }
}

// --- AFFICHAGE MESSAGES (GROUPING) ---
function displayMessage(msg, isDm = false) {
    const container = document.getElementById('messages');
    
    // Logic Grouping
    const msgTime = new Date(msg.timestamp).getTime();
    const isSameAuthor = (msg.ownerId === lastMsgAuthorId);
    const isRecent = (msgTime - lastMsgTime) < 120000; // 2 minutes
    const isGrouped = isSameAuthor && isRecent && !msg.replyTo && msg.type === 'text'; // On ne groupe pas si image/réponse

    const div = document.createElement('div');
    div.className = 'message-container';
    if(isGrouped) div.classList.add('msg-group-followup');
    div.id = `msg-${msg._id}`;

    // Contenu
    let contentHTML = "";
    if (msg.type === 'image') contentHTML = `<img src="${msg.content}" class="chat-image" onclick="window.open(this.src)">`;
    else if (msg.type === 'video') contentHTML = `<video src="${msg.content}" class="video-direct" controls></video>`;
    else if (msg.type === 'audio') contentHTML = renderCustomAudio(msg.content);
    else contentHTML = `<div class="text-body">${formatText(msg.content)}</div>`;

    // Reply UI
    let replyHTML = "";
    if(msg.replyTo) {
        replyHTML = `<div style="font-size:0.75rem; color:#aaa; margin-bottom:5px; border-left:2px solid #555; padding-left:5px;">Rep: ${msg.replyTo.author}</div>`;
    }

    // Header (Nom/Avatar) - Caché par CSS si .msg-group-followup, mais présent dans DOM
    const senderName = msg.senderName || msg.sender;
    const avatar = msg.senderAvatar || `https://ui-avatars.com/api/?name=${senderName}`;
    
    div.innerHTML = `
        <div class="msg-actions">
            <button class="action-btn" onclick="triggerReply('${msg._id}', '${senderName}', '${msg.content}')"><i class="fa-solid fa-reply"></i></button>
            ${(msg.ownerId === PLAYER_ID || IS_ADMIN) ? `<button class="action-btn" onclick="triggerDelete('${msg._id}')" style="color:#da373c;"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>
        ${replyHTML}
        <img src="${avatar}" class="avatar-img" onclick="openProfile('${senderName}')">
        <div style="margin-left: 55px;">
            <div class="char-header">
                <span class="char-name" style="color:${msg.senderColor || 'white'}" onclick="openProfile('${senderName}')">${senderName}</span>
                <span class="timestamp">${msg.date}</span>
            </div>
            ${contentHTML}
        </div>
    `;

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    // Mise à jour tracking
    lastMsgAuthorId = msg.ownerId;
    lastMsgTime = msgTime;
}

function joinRoom(roomId) {
    if(currentRoomId !== roomId) {
        socket.emit('leave_room', currentRoomId);
        lastMsgAuthorId = null; // Reset grouping
    }
    currentRoomId = roomId; currentDmTarget = null;
    socket.emit('join_room', roomId);
    socket.emit('request_history', roomId);
    document.getElementById('messages').innerHTML = "";
    document.getElementById('char-selector-wrapper').classList.remove('hidden');
    document.getElementById('currentRoomName').textContent = (roomId==='global' ? 'Global' : 'Salon');
}

// --- SOCIAL & FEED ---
function submitPost() {
    const content = document.getElementById('postContent').value.trim();
    const staged = stagedFiles['post'];
    if(!content && !staged) return;

    // Si staged, upload
    if(staged) {
        uploadToCloudinary(staged.file).then(url => {
            emitPost(content, url, staged.type);
            clearPostStaging();
        });
    } else {
        emitPost(content, null, null);
    }
}

function emitPost(content, mediaUrl, mediaType) {
    const sel = document.getElementById('feedCharSelector');
    const opt = sel.options[sel.selectedIndex];
    socket.emit('create_post', {
        content, mediaUrl, mediaType,
        authorName: opt.value, authorAvatar: opt.dataset.avatar, authorRole: opt.dataset.role,
        date: new Date().toLocaleDateString(), ownerId: PLAYER_ID
    });
    document.getElementById('postContent').value = "";
}

// Détail Post (Commentaires)
let currentDetailPostId = null;
function openPostDetail(postId) {
    const postEl = document.getElementById(`post-${postId}`);
    if(!postEl) return;
    currentDetailPostId = postId;
    document.getElementById('post-detail-content').innerHTML = postEl.innerHTML;
    // Supprimer les boutons d'action du clone pour éviter doublons ID
    const cloneActions = document.querySelector('#post-detail-content .post-actions');
    if(cloneActions) cloneActions.remove();
    
    // Charger commentaires (via DOM existant caché ou requête fetch si besoin, ici DOM)
    const hiddenComments = postEl.querySelector('.comments-data-json');
    const comments = hiddenComments ? JSON.parse(hiddenComments.textContent) : [];
    renderCommentsList(comments);
    
    document.getElementById('post-detail-modal').classList.remove('hidden');
    
    // Action Envoyer Commentaire
    document.getElementById('btn-detail-comment').onclick = async () => {
        const txt = document.getElementById('post-detail-comment-input').value.trim();
        const staged = stagedFiles['comment'];
        
        let mediaUrl = null, mediaType = null;
        if(staged) {
            mediaUrl = await uploadToCloudinary(staged.file);
            mediaType = staged.type;
        }

        if(!txt && !mediaUrl) return;
        
        const sel = document.getElementById('feedCharSelector');
        socket.emit('post_comment', { 
            postId, 
            comment: { 
                authorName: sel.options[sel.selectedIndex].value, 
                authorAvatar: sel.options[sel.selectedIndex].dataset.avatar, 
                content: txt, 
                mediaUrl, mediaType,
                date: new Date().toLocaleTimeString(), 
                ownerId: PLAYER_ID 
            } 
        });
        document.getElementById('post-detail-comment-input').value = "";
        clearCommentStaging();
    };
}

function renderCommentsList(comments) {
    const list = document.getElementById('post-detail-comments-list');
    list.innerHTML = "";
    comments.forEach(c => {
        let media = "";
        if(c.mediaType === 'image') media = `<img src="${c.mediaUrl}" style="max-width:200px; border-radius:4px; display:block; margin-top:5px;">`;
        else if(c.mediaType === 'audio') media = renderCustomAudio(c.mediaUrl);
        
        list.innerHTML += `
            <div style="margin-bottom:10px; border-bottom:1px solid #333; padding-bottom:5px;">
                <div style="font-weight:bold; color:var(--accent); font-size:0.85rem;">${c.authorName} <span style="font-weight:normal; color:#666;">${c.date}</span></div>
                <div style="font-size:0.9rem;">${c.content || ""}</div>
                ${media}
            </div>`;
    });
}

socket.on('feed_data', (posts) => {
    const stream = document.getElementById('feed-stream'); stream.innerHTML = "";
    posts.forEach(p => stream.appendChild(createPostElement(p)));
});
socket.on('new_post', (p) => document.getElementById('feed-stream').prepend(createPostElement(p)));
socket.on('post_updated', (p) => {
    const old = document.getElementById(`post-${p._id}`);
    if(old) old.replaceWith(createPostElement(p));
    if(currentDetailPostId === p._id) renderCommentsList(p.comments);
});

function createPostElement(post) {
    const div = document.createElement('div');
    div.className = 'post-card'; div.id = `post-${post._id}`;
    
    // Média Post
    let mediaHTML = "";
    if(post.mediaUrl) {
        if(post.mediaType === 'video') mediaHTML = `<video src="${post.mediaUrl}" controls class="post-media"></video>`;
        else if(post.mediaType === 'audio') mediaHTML = renderCustomAudio(post.mediaUrl);
        else mediaHTML = `<img src="${post.mediaUrl}" class="post-media">`;
    }

    div.innerHTML = `
        <div class="post-header" onclick="openProfile('${post.authorName}')">
            <img src="${post.authorAvatar}" class="post-avatar">
            <div><div class="post-author">${post.authorName}</div><div style="font-size:0.75rem; color:#aaa;">${post.authorRole} - ${post.date}</div></div>
        </div>
        <div class="post-content" onclick="openPostDetail('${post._id}')">${formatText(post.content)}</div>
        ${mediaHTML}
        <div class="post-actions">
            <button class="action-item" onclick="socket.emit('like_post', {postId:'${post._id}', userId:PLAYER_ID})"><i class="fa-solid fa-heart"></i> ${post.likes.length}</button>
            <button class="action-item" onclick="openPostDetail('${post._id}')"><i class="fa-solid fa-comment"></i> ${post.comments.length}</button>
        </div>
        <script type="application/json" class="comments-data-json">${JSON.stringify(post.comments)}</script>
    `;
    return div;
}

// --- PROFIL & FOLLOW ---
let currentProfileCharId = null;
let currentProfileIsFollowed = false;

function openProfile(charName) { socket.emit('get_char_profile', charName); }
socket.on('char_profile_data', (char) => {
    document.getElementById('profileName').textContent = char.name;
    document.getElementById('profileRole').textContent = char.role;
    document.getElementById('profileDesc').textContent = char.description || "Aucune description.";
    document.getElementById('profileAvatar').src = char.avatar;
    document.getElementById('profileOwner').textContent = `Joué par : ${char.ownerUsername || '?'}`;
    
    // Follow Logic
    currentProfileCharId = char._id;
    currentProfileIsFollowed = char.followers && char.followers.includes(PLAYER_ID);
    updateFollowButton();

    document.getElementById('profile-modal').classList.remove('hidden');
    document.getElementById('btn-dm-profile').onclick = () => { document.getElementById('profile-modal').classList.add('hidden'); openDm(char.ownerUsername); };
});
socket.on('char_profile_updated', (char) => {
    if(currentProfileCharId === char._id) {
        currentProfileIsFollowed = char.followers.includes(PLAYER_ID);
        updateFollowButton();
    }
});

function toggleFollow() {
    if(!currentProfileCharId) return;
    socket.emit('follow_char', { charId: currentProfileCharId, userId: PLAYER_ID });
}
function updateFollowButton() {
    const btn = document.getElementById('btn-follow');
    if(currentProfileIsFollowed) {
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Abonné';
        btn.style.color = "#23a559";
    } else {
        btn.innerHTML = '<i class="fa-solid fa-star"></i> S\'abonner';
        btn.style.color = "white";
    }
}

// --- NOTIFICATIONS SYSTEM ---
let unreadNotifCount = 0;
socket.on('notifications_data', (notifs) => {
    const list = document.getElementById('notif-modal-content');
    list.innerHTML = "";
    unreadNotifCount = 0;
    
    if(notifs.length === 0) list.innerHTML = "<p style='color:#aaa; padding:10px;'>Rien à signaler.</p>";
    
    notifs.forEach(n => {
        if(!n.read) unreadNotifCount++;
        let icon = '<i class="fa-solid fa-info"></i>';
        if(n.type === 'like') icon = '<i class="fa-solid fa-heart" style="color:#da373c;"></i>';
        if(n.type === 'comment') icon = '<i class="fa-solid fa-comment" style="color:#5865F2;"></i>';
        if(n.type === 'follow') icon = '<i class="fa-solid fa-star" style="color:#eab308;"></i>';

        list.innerHTML += `
            <div class="notif-item ${!n.read ? 'unread' : ''}">
                <div class="notif-icon">${icon}</div>
                <div>
                    <div style="font-weight:bold; font-size:0.8rem; color:#aaa;">${n.triggerName}</div>
                    <div>${n.content}</div>
                    <div style="font-size:0.7rem; color:#666;">${n.date}</div>
                </div>
            </div>`;
    });
    
    updateBadge();
});

socket.on('notification_trigger', (data) => {
    if(data.recipientId === PLAYER_ID) {
        // Simple refresh request pour éviter complexité
        socket.emit('request_initial_data', PLAYER_ID);
        // Son de notif si besoin
    }
});

function updateBadge() {
    const badge = document.getElementById('notif-badge');
    badge.textContent = unreadNotifCount;
    if(unreadNotifCount > 0) badge.classList.add('visible');
    else badge.classList.remove('visible');
}

function openNotifications() { document.getElementById('notifications-modal').classList.remove('hidden'); }
function closeNotifications() { document.getElementById('notifications-modal').classList.add('hidden'); }
function markNotificationsRead() {
    socket.emit('mark_notifications_read', PLAYER_ID);
}

// Utils
function formatText(t) { if(!t) return ""; return t.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\*(.*?)\*/g, '<i>$1</i>'); }
function cancelContext() { currentContext = null; document.getElementById('context-bar').classList.add('hidden'); }
function triggerReply(id, author, content) {
    currentContext = { type: 'reply', data: { id, author, content } };
    document.getElementById('context-bar').classList.remove('hidden');
    document.getElementById('context-text').innerHTML = `Réponse à <b>${author}</b>`;
}

// INITIALISATION UI
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function openAccountUI() { document.getElementById('user-settings-modal').classList.remove('hidden'); }
function closeUserSettingsModal() { document.getElementById('user-settings-modal').classList.add('hidden'); }
function closeProfileModal() { document.getElementById('profile-modal').classList.add('hidden'); }
function closePostDetail() { document.getElementById('post-detail-modal').classList.add('hidden'); }
function toggleCreateForm() { document.getElementById('create-char-form').classList.toggle('hidden'); }
