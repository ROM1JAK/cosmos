var socket = io();
const notifSound = new Audio('https://cdn.discordapp.com/attachments/1323488087288053821/1443747694408503446/notif.mp3?ex=692adb11&is=69298991&hm=8e0c05da67995a54740ace96a2e4630c367db762c538c2dffc11410e79678ed5&'); 

// CONFIGURATION CLOUDINARY
const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/dllr3ugxz/auto/upload'; 
const CLOUDINARY_PRESET = 'Cosmos';

let myCharacters = [];
let allRooms = []; 
let currentRoomId = 'global'; 
let currentDmTarget = null; 
let PLAYER_ID; 
let USERNAME; 
let IS_ADMIN = false;
let currentContext = null; 
let typingTimeout = null;
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

// VARIABLES STAGING & GROUPING
let currentStagedMedia = null; // Blob ou File
let currentStagedType = null; // 'image' ou 'audio'
let currentStagedSource = null; // 'chat' ou 'comment'

let lastMessageState = { sender: null, time: null };

// --- FONCTION D'UPLOAD ---
async function uploadToCloudinary(file) {
    if (!file) return null;
    if (!(file instanceof Blob) && !file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        alert("Fichier non supporté."); return null;
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_PRESET);
    try {
        const response = await fetch(CLOUDINARY_URL, { method: 'POST', body: formData });
        if (!response.ok) throw new Error('Erreur upload Cloudinary');
        const data = await response.json();
        return data.secure_url; 
    } catch (error) {
        console.error("Erreur Upload:", error); alert("Erreur lors de l'envoi du média."); return null;
    }
}

// --- NAVIGATION & STAGING RESET ---
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

// --- MEDIA STAGING LOGIC ---
function handleMediaStaging(file, type, source) {
    currentStagedMedia = file;
    currentStagedType = type;
    currentStagedSource = source;
    
    // UI Preview
    const container = (source === 'comment') ? document.getElementById('comment-staging-area') : document.getElementById('media-staging-area');
    container.classList.remove('hidden');
    container.innerHTML = "";

    let previewContent = "";
    if (type === 'image') {
        const url = URL.createObjectURL(file);
        previewContent = `<img src="${url}">`;
    } else if (type === 'audio') {
        previewContent = `<div class="custom-audio-player"><div class="custom-audio-play-btn"><i class="fa-solid fa-play"></i></div><div style="color:#aaa; font-size:0.8em;">Message Vocal</div></div>`;
    }

    container.innerHTML = `
        ${previewContent}
        <div class="media-staging-info">
            <button class="btn-primary" style="padding:4px 8px; font-size:0.8em;" onclick="confirmMediaSend()">Envoyer</button>
            <button class="btn-secondary" style="padding:4px 8px; font-size:0.8em;" onclick="cancelMedia()">Annuler</button>
        </div>
    `;
}

async function confirmMediaSend() {
    if(!currentStagedMedia) return;
    
    // Show Loading
    const btn = document.querySelector('.media-staging .btn-primary');
    if(btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    const url = await uploadToCloudinary(currentStagedMedia);
    if(url) {
        if(currentStagedSource === 'chat') {
            sendMediaMessage(url, currentStagedType);
        } else if (currentStagedSource === 'comment') {
            submitCommentWithMedia(url, currentStagedType);
        }
    }
    cancelMedia(); // Reset UI
}

function cancelMedia() {
    currentStagedMedia = null;
    currentStagedType = null;
    currentStagedSource = null;
    document.getElementById('media-staging-area').classList.add('hidden');
    document.getElementById('media-staging-area').innerHTML = "";
    document.getElementById('comment-staging-area').classList.add('hidden');
    document.getElementById('comment-staging-area').innerHTML = "";
    document.getElementById('chatImageInput').value = ""; // Reset input
    document.getElementById('commentMediaFile').value = "";
}

function handleChatImageSelect() {
    const file = document.getElementById('chatImageInput').files[0];
    if(file) handleMediaStaging(file, 'image', 'chat');
}

function handleCommentMediaSelect() {
    const file = document.getElementById('commentMediaFile').files[0];
    if(file) handleMediaStaging(file, 'image', 'comment');
}

// --- RECORDING ---
async function toggleRecording(source) { 
    const btnId = `btn-record-${source}`;
    const btn = document.getElementById(btnId);
    if(!btn) return; // Fix bug null

    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.start();
            isRecording = true;
            btn.classList.add('recording');
        } catch (err) { alert("Micro inaccessible."); }
    } else {
        mediaRecorder.stop();
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            btn.classList.remove('recording');
            isRecording = false;

            if (source === 'feed') {
                 // Feed direct upload preview
                 const url = await uploadToCloudinary(audioBlob);
                 if(url) {
                     document.getElementById('postMediaUrl').value = url;
                     document.getElementById('postFileStatus').style.display = 'block';
                     document.getElementById('postFileStatus').innerHTML = 'Audio enregistré <i class="fa-solid fa-check"></i>';
                 }
            } else {
                 // Chat & Comment -> Staging
                 handleMediaStaging(audioBlob, 'audio', source);
            }
        };
    }
}

// --- CUSTOM AUDIO PLAYER LOGIC ---
document.addEventListener('click', function(e) {
    if(e.target.closest('.custom-audio-play-btn')) {
        const btn = e.target.closest('.custom-audio-play-btn');
        const wrapper = btn.closest('.custom-audio-player');
        const audio = wrapper.querySelector('audio');
        const icon = btn.querySelector('i');
        const bar = wrapper.querySelector('.custom-audio-bar');

        if (audio.paused) {
            audio.play();
            icon.className = 'fa-solid fa-pause';
        } else {
            audio.pause();
            icon.className = 'fa-solid fa-play';
        }

        audio.ontimeupdate = () => {
            const pct = (audio.currentTime / audio.duration) * 100;
            if(bar) bar.style.width = `${pct}%`;
        };
        audio.onended = () => {
            icon.className = 'fa-solid fa-play';
            if(bar) bar.style.width = '0%';
        };
    }
});

// --- UI INIT ---
socket.on('login_success', (data) => {
    localStorage.setItem('rp_username', data.username);
    localStorage.setItem('rp_code', data.userId);
    USERNAME = data.username;
    PLAYER_ID = data.userId;
    IS_ADMIN = data.isAdmin;
    document.getElementById('player-id-display').textContent = `Compte : ${USERNAME}`;
    document.getElementById('player-id-display').style.color = IS_ADMIN ? "#da373c" : "var(--accent)";
    document.getElementById('btn-account-main').innerHTML = '<i class="fa-solid fa-user"></i> Mon Profil';
    document.getElementById('btn-account-main').style.background = "#2b2d31"; 
    closeLoginModal();
    socket.emit('request_initial_data', PLAYER_ID);
    socket.emit('request_dm_contacts', USERNAME);
    const lastTab = localStorage.getItem('last_tab');
    if (lastTab) switchView(lastTab);
    const savedRoom = localStorage.getItem('saved_room_id');
    if (savedRoom) joinRoom(savedRoom); else joinRoom('global');
});

// ... [Existing standard socket handlers like login_error, auto login check, etc. kept same] ...
// (Pour la brièveté, je garde les fonctions standards non modifiées implicitement)

socket.on('login_error', (msg) => { const el = document.getElementById('login-error-msg'); el.textContent = msg; el.style.display = 'block'; });
function checkAutoLogin() {
    const savedUser = localStorage.getItem('rp_username');
    const savedCode = localStorage.getItem('rp_code');
    if (savedUser && savedCode) socket.emit('login_request', { username: savedUser, code: savedCode });
    else openLoginModal();
}
socket.on('connect', () => { checkAutoLogin(); });

// --- ROOMS & CHAT ---
function joinRoom(roomId) {
    if (allRooms.length > 0 && roomId !== 'global' && !allRooms.find(r => r._id === roomId)) roomId = 'global';
    if (currentRoomId && currentRoomId !== roomId) socket.emit('leave_room', currentRoomId);
    currentRoomId = roomId;
    localStorage.setItem('saved_room_id', roomId);
    currentDmTarget = null; 
    socket.emit('join_room', currentRoomId);
    
    // Reset Grouping State
    lastMessageState = { sender: null, time: null };

    document.getElementById('currentRoomName').textContent = (allRooms.find(r => r._id === roomId))?.name || 'Salon Global';
    document.getElementById('messages').innerHTML = ""; 
    document.getElementById('char-selector-wrapper').classList.remove('hidden'); 
    document.getElementById('dm-header-actions').classList.add('hidden');
    socket.emit('request_history', currentRoomId);
    updateRoomListUI();
}

// --- DISPLAY MESSAGE (GROUPING) ---
socket.on('history_data', (msgs) => { 
    if(currentDmTarget) return; 
    const container = document.getElementById('messages'); container.innerHTML = ""; 
    lastMessageState = { sender: null, time: null }; // Reset for history
    msgs.forEach(msg => { displayMessage(msg); });
    scrollToBottom(); 
});
socket.on('message_rp', (msg) => { 
    if (msg.ownerId !== PLAYER_ID && notificationsEnabled) notifSound.play().catch(e => {});
    if(msg.roomId === currentRoomId && !currentDmTarget) { displayMessage(msg); scrollToBottom(); } 
    else { unreadRooms.add(msg.roomId); updateRoomListUI(); }
});

function displayMessage(msg, isDm = false) {
    const div = document.createElement('div');
    div.className = 'message-container'; if(isDm) div.classList.add('dm-message'); div.id = `msg-${msg._id}`;
    let senderName = isDm ? (msg.sender || msg.senderName) : msg.senderName;
    let senderAvatar = isDm ? `https://ui-avatars.com/api/?name=${senderName}&background=random` : msg.senderAvatar;
    let senderColor = isDm ? "#dbdee1" : msg.senderColor;
    let senderRole = isDm ? "Utilisateur" : msg.senderRole;

    // Grouping Logic
    const msgTime = new Date(msg.timestamp || Date.now()).getTime();
    const timeDiff = msgTime - (lastMessageState.time || 0);
    const sameSender = lastMessageState.sender === senderName;
    let isGrouped = (sameSender && timeDiff < 120000 && !isDm); // < 2 mins

    if(isGrouped) div.classList.add('message-group-follow');
    
    // Update State
    lastMessageState = { sender: senderName, time: msgTime };

    // Content Generation
    let contentHTML = "";
    if (msg.type === "image") contentHTML = `<img src="${msg.content}" class="chat-image" onclick="window.open(this.src)">`;
    else if (msg.type === "video" || msg.content.includes('/video/upload')) contentHTML = `<video class="video-direct" controls><source src="${msg.content}"></video>`;
    else if (msg.type === "audio") {
        contentHTML = `<div class="custom-audio-player"><audio src="${msg.content}"></audio><div class="custom-audio-play-btn"><i class="fa-solid fa-play"></i></div><div class="custom-audio-progress"><div class="custom-audio-bar"></div></div></div>`;
    }
    else contentHTML = `<div class="text-body" id="content-${msg._id}">${formatText(msg.content)}</div>`;

    const avatarClick = isDm ? "" : `onclick="openProfile('${senderName.replace(/'/g, "\\'")}')"`;
    
    // Structure HTML conditionnelle (header caché si groupé)
    div.innerHTML = `
        <div class="msg-actions">
            <button class="action-btn" onclick="triggerReply('${msg._id}', '${senderName.replace(/'/g, "\\'")}', '...')"><i class="fa-solid fa-reply"></i></button>
            ${(msg.ownerId === PLAYER_ID || IS_ADMIN) ? `<button class="action-btn" onclick="triggerDelete('${msg._id}')" style="color:#da373c;"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>
        <div style="position:relative; margin-left: 55px;">
            <img src="${senderAvatar}" class="avatar-img" ${avatarClick}>
            <div class="char-header">
                <span class="char-name" style="color: ${senderColor}" ${avatarClick}>${senderName}</span>
                <span class="char-role">${senderRole || ""}</span>
                <span class="timestamp">${msg.date}</span>
            </div>
            ${contentHTML}
        </div>`;
    document.getElementById('messages').appendChild(div);
}

// --- SOCIAL / FOLLOW / NOTIFICATIONS ---
socket.on('notifications_data', (notifs) => {
    updateNotifsList(notifs);
});
socket.on('new_notification', (data) => {
    if(data.recipientId === PLAYER_ID) {
        // Ajouter à la liste UI, incrémenter badge
        updateNotifsList([data.notif], true); // true = append
        // Sound ?
    }
});

function updateNotifsList(notifs, append = false) {
    const list = document.getElementById('notifs-list');
    const badge = document.getElementById('notif-badge');
    
    if(!append) list.innerHTML = "";
    
    let unreadCount = 0;
    notifs.forEach(n => {
        if(!n.read) unreadCount++;
        const item = document.createElement('div');
        item.className = `notif-item ${n.read ? '' : 'unread'}`;
        item.innerHTML = `<span>${n.message}</span><span class="notif-time">Just now</span>`;
        list.prepend(item);
    });

    if(unreadCount > 0 || append) {
        badge.classList.remove('hidden');
    }
}

function toggleNotifsModal() {
    const modal = document.getElementById('notifs-modal');
    if(modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        document.getElementById('notif-badge').classList.add('hidden');
        socket.emit('mark_notifs_read', PLAYER_ID);
    } else {
        modal.classList.add('hidden');
    }
}

function toggleFollow() {
    const profileName = document.getElementById('profileName').textContent;
    // On doit trouver l'ID du perso ouvert... C'est un peu tricky car on a que le nom dans le modal actuel.
    // Idéalement on stocke l'ID dans le DOM du modal
    const charId = document.getElementById('profile-modal').dataset.charId;
    if(!charId) return;

    // Pas de perso sélectionné pour le follower ? On utilise le premier perso ou user
    socket.emit('follow_char', { 
        charId: charId, 
        followerId: PLAYER_ID, 
        followerName: USERNAME 
    });
}

socket.on('char_profile_data', (char) => {
    const modal = document.getElementById('profile-modal');
    modal.dataset.charId = char._id; // Store ID
    document.getElementById('profileName').textContent = char.name;
    document.getElementById('profileRole').textContent = char.role;
    document.getElementById('profileAvatar').src = char.avatar;
    document.getElementById('profileDesc').textContent = char.description || "";
    document.getElementById('profileOwner').textContent = `Joué par : ${char.ownerUsername || "?"}`;
    
    const isFollower = char.followers && char.followers.includes(PLAYER_ID);
    const followBtn = document.getElementById('btn-follow-profile');
    followBtn.textContent = isFollower ? "Désabonner" : "S'abonner";
    followBtn.onclick = toggleFollow;
    
    document.getElementById('profileFollowStats').textContent = `${char.followers ? char.followers.length : 0} abonnés`;

    modal.classList.remove('hidden');
});
socket.on('char_profile_updated', (char) => {
    // Refresh si ouvert
    const modal = document.getElementById('profile-modal');
    if(!modal.classList.contains('hidden') && modal.dataset.charId === char._id) {
        socket.emit('get_char_profile', char.name);
    }
});

// --- SUBMIT COMMENTS + MEDIA ---
function submitCommentWithMedia(mediaUrl, mediaType) {
    if(!currentDetailPostId) return;
    const txt = document.getElementById('post-detail-comment-input').value.trim();
    const sel = document.getElementById('feedCharSelector');
    if(sel.options.length === 0) return alert("Perso requis");
    
    // On construit le contenu avec le média
    let finalContent = txt;
    // Note: Le backend supporte mediaUrl dans comment mais ici on l'ajoute au texte ou on utilise les champs du schema
    // Le schema Post a: mediaUrl dans comment.
    
    socket.emit('post_comment', { 
        postId: currentDetailPostId, 
        comment: { 
            authorName: sel.options[sel.selectedIndex].value, 
            authorAvatar: sel.options[sel.selectedIndex].dataset.avatar, 
            content: finalContent, // Texte
            mediaUrl: mediaUrl,    // URL
            mediaType: mediaType,  // Type
            date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), 
            ownerId: PLAYER_ID 
        } 
    });
    document.getElementById('post-detail-comment-input').value = "";
}

// Fonction existante légèrement modifiée pour afficher media en commentaire
function generateCommentsHTML(comments, postId) {
    let html = "";
    comments.forEach(c => {
        let mediaHtml = "";
        if(c.mediaUrl) {
            if(c.mediaType === 'audio') mediaHtml = `<div class="custom-audio-player"><audio src="${c.mediaUrl}"></audio><div class="custom-audio-play-btn"><i class="fa-solid fa-play"></i></div><div class="custom-audio-progress"><div class="custom-audio-bar"></div></div></div>`;
            else mediaHtml = `<img src="${c.mediaUrl}" style="max-height:100px; display:block; margin-top:5px; border-radius:4px;">`;
        }
        
        html += `<div class="comment-item">
            <div class="comment-bubble">
                <div class="comment-meta"><img src="${c.authorAvatar}" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:5px;"><span class="comment-author">${c.authorName}</span><span>${c.date}</span></div>
                <div style="margin-left:25px;">${c.content} ${mediaHtml}</div>
            </div>
        </div>`;
    });
    return html;
}

// --- STANDARD FUNCTIONS (Keep existing structure) ---
function sendMediaMessage(content, type) {
    if(!currentSelectedChar) return alert("Sélectionnez un personnage d'abord !");
    socket.emit('message_rp', { 
        content: content, type: type, 
        senderName: currentSelectedChar.name, senderColor: currentSelectedChar.color, 
        senderAvatar: currentSelectedChar.avatar, senderRole: currentSelectedChar.role, 
        ownerId: PLAYER_ID, targetName: "", roomId: currentRoomId, 
        date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) 
    });
}
function scrollToBottom() { const d = document.getElementById('messages'); d.scrollTop = d.scrollHeight; }
function formatText(text) { if(!text) return ""; return text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\*(.*?)\*/g, '<i>$1</i>'); }
function getYoutubeId(url) { const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/); return (match && match[2].length === 11) ? match[2] : null; }
