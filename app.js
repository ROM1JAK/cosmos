var socket = io();
const notifSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'); 
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
let lastFeedVisit = 0; 
let currentDetailPostId = null; // Pour savoir quel post est ouvert en full page

// --- NAVIGATION ---
function switchView(view) {
    currentView = view;
    document.querySelectorAll('.view-section').forEach(el => {
        el.classList.remove('active');
        el.classList.add('hidden');
    });
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));

    document.getElementById(`view-${view}`).classList.remove('hidden');
    document.getElementById(`view-${view}`).classList.add('active');
    document.getElementById(`btn-view-${view}`).classList.add('active');

    if(view === 'feed') {
        document.getElementById('feed-notif-dot').classList.add('hidden'); 
        lastFeedVisit = Date.now();
        loadFeed();
    }
}

// --- UI & LOGIN ---
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); document.getElementById('mobile-overlay').classList.toggle('open'); }
function toggleCreateForm() { document.getElementById('create-char-form').classList.toggle('hidden'); }
function openAccountUI() { if (PLAYER_ID) openUserSettingsModal(); else openLoginModal(); }
function openLoginModal() { document.getElementById('login-modal').classList.remove('hidden'); document.getElementById('login-error-msg').style.display = "none"; }
function closeLoginModal() { document.getElementById('login-modal').classList.add('hidden'); }
function submitLogin() {
    const pseudo = document.getElementById('loginPseudoInput').value.trim();
    const code = document.getElementById('loginCodeInput').value.trim();
    if (pseudo && code) socket.emit('login_request', { username: pseudo, code: code });
}
function logoutUser() { if(confirm("Déconnexion ?")) { localStorage.removeItem('rp_username'); localStorage.removeItem('rp_code'); location.reload(); } }
function openUserSettingsModal() {
    document.getElementById('settingsUsernameInput').value = USERNAME || "";
    document.getElementById('settingsCodeInput').value = PLAYER_ID || ""; 
    document.getElementById('settings-msg').textContent = "";
    document.getElementById('user-settings-modal').classList.remove('hidden');
}
function closeUserSettingsModal() { document.getElementById('user-settings-modal').classList.add('hidden'); }
function toggleSecretVisibility() { const input = document.getElementById('settingsCodeInput'); input.type = (input.type === "password") ? "text" : "password"; }
function submitUsernameChange() {
    const newName = document.getElementById('settingsUsernameInput').value.trim();
    if (newName && newName !== USERNAME) socket.emit('change_username', { userId: PLAYER_ID, newUsername: newName });
    else { document.getElementById('settings-msg').textContent = "Pas de changement."; document.getElementById('settings-msg').style.color = "#eab308"; }
}
socket.on('login_success', (data) => {
    localStorage.setItem('rp_username', data.username);
    localStorage.setItem('rp_code', data.userId);
    USERNAME = data.username; PLAYER_ID = data.userId; IS_ADMIN = data.isAdmin;
    document.getElementById('player-id-display').textContent = `Compte : ${USERNAME}`;
    document.getElementById('player-id-display').style.color = IS_ADMIN ? "#da373c" : "var(--accent)";
    document.getElementById('btn-account-main').textContent = "👤 Mon Profil";
    document.getElementById('btn-account-main').style.background = "#2b2d31"; 
    closeLoginModal();
    socket.emit('request_initial_data', PLAYER_ID);
    socket.emit('request_dm_contacts', USERNAME);
    joinRoom('global');
});
socket.on('login_error', (msg) => { const el = document.getElementById('login-error-msg'); el.textContent = msg; el.style.display = 'block'; });
socket.on('username_change_success', (newName) => { USERNAME = newName; localStorage.setItem('rp_username', newName); document.getElementById('player-id-display').textContent = `Compte : ${USERNAME}`; const msgEl = document.getElementById('settings-msg'); msgEl.textContent = "Pseudo mis à jour !"; msgEl.style.color = "#23a559"; });
socket.on('username_change_error', (msg) => { const msgEl = document.getElementById('settings-msg'); msgEl.textContent = msg; msgEl.style.color = "#da373c"; });
function checkAutoLogin() {
    const savedUser = localStorage.getItem('rp_username'); const savedCode = localStorage.getItem('rp_code');
    if (savedUser && savedCode) socket.emit('login_request', { username: savedUser, code: savedCode }); else openLoginModal();
}
socket.on('connect', () => { checkAutoLogin(); });
socket.on('update_user_list', (users) => {
    const listDiv = document.getElementById('online-users-list'); document.getElementById('online-count').textContent = users.length;
    listDiv.innerHTML = ""; users.forEach(u => { listDiv.innerHTML += `<div class="online-user" onclick="startDmFromList('${u}')"><span class="status-dot"></span><span>${u}</span></div>` });
});
socket.on('force_history_refresh', (data) => { if (currentRoomId === data.roomId && !currentDmTarget) socket.emit('request_history', currentRoomId); });

// --- MEDIAS ---
function previewFile(type) {
    const fileInput = document.getElementById(type === 'new' ? 'newCharFile' : 'editCharFile'); const hiddenInput = document.getElementById(type === 'new' ? 'newCharBase64' : 'editCharBase64');
    const file = fileInput.files[0];
    if (file) {
        if (file.size > 2 * 1024 * 1024) { alert("Max 2 Mo"); fileInput.value = ""; return; }
        const reader = new FileReader(); reader.onloadend = function() { hiddenInput.value = reader.result; }; reader.readAsDataURL(file);
    }
}
function openUrlModal() { document.getElementById('url-modal').classList.remove('hidden'); }
function closeUrlModal() { document.getElementById('url-modal').classList.add('hidden'); }
function submitImageUrl() { const url = document.getElementById('urlInput').value.trim(); if(url) { sendMediaMessage(url, 'image'); document.getElementById('urlInput').value = ""; closeUrlModal(); } }
function openVideoModal() { document.getElementById('video-modal').classList.remove('hidden'); }
function closeVideoModal() { document.getElementById('video-modal').classList.add('hidden'); }
function submitVideoUrl() { const url = document.getElementById('videoInput').value.trim(); if(url) { sendMediaMessage(url, 'video'); document.getElementById('videoInput').value = ""; closeVideoModal(); } }
function sendMediaMessage(content, type) {
    if (currentDmTarget) { socket.emit('send_dm', { sender: USERNAME, target: currentDmTarget, content: content, type: type, date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) }); return; }
    const sel = document.getElementById('charSelector'); if(sel.options.length === 0) return alert("Créez un personnage d'abord !");
    const opt = sel.options[sel.selectedIndex];
    socket.emit('message_rp', { content: content, type: type, senderName: opt.value, senderColor: opt.dataset.color, senderAvatar: opt.dataset.avatar, senderRole: opt.dataset.role, ownerId: PLAYER_ID, targetName: "", roomId: currentRoomId, date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), replyTo: null });
}

// --- CHAT LOGIC ---
const txtInput = document.getElementById('txtInput');
txtInput.addEventListener('input', () => {
    if(currentDmTarget) return; 
    const sel = document.getElementById('charSelector'); const name = sel.options[sel.selectedIndex]?.text || "Quelqu'un";
    socket.emit('typing_start', { roomId: currentRoomId, charName: name });
    clearTimeout(typingTimeout); typingTimeout = setTimeout(() => { socket.emit('typing_stop', { roomId: currentRoomId, charName: name }); }, 1000);
});
socket.on('display_typing', (data) => { if(data.roomId === currentRoomId && !currentDmTarget) { document.getElementById('typing-indicator').classList.remove('hidden'); document.getElementById('typing-text').textContent = `${data.charName} écrit...`; } });
socket.on('hide_typing', (data) => { if(data.roomId === currentRoomId) document.getElementById('typing-indicator').classList.add('hidden'); });
function createRoomPrompt() { const name = prompt("Nom du salon :"); if (name) socket.emit('create_room', { name, creatorId: PLAYER_ID, allowedCharacters: [] }); }
function deleteRoom(roomId) { if(confirm("ADMIN : Supprimer ?")) socket.emit('delete_room', roomId); }
function joinRoom(roomId) {
    if (currentRoomId && currentRoomId !== roomId) socket.emit('leave_room', currentRoomId);
    currentRoomId = roomId; currentDmTarget = null; 
    socket.emit('join_room', currentRoomId); if (unreadRooms.has(currentRoomId)) unreadRooms.delete(currentRoomId);
    const room = allRooms.find(r => r._id === roomId);
    document.getElementById('currentRoomName').textContent = room ? room.name : 'Salon Global'; document.getElementById('currentRoomName').style.color = "white";
    document.getElementById('messages').innerHTML = ""; document.getElementById('typing-indicator').classList.add('hidden');
    document.getElementById('charSelector').style.display = 'block'; document.getElementById('dm-header-actions').classList.add('hidden'); 
    socket.emit('request_history', currentRoomId); cancelContext();
    if(window.innerWidth <= 768) { document.getElementById('sidebar').classList.remove('open'); document.getElementById('mobile-overlay').classList.remove('open'); }
    updateRoomListUI(); updateDmListUI(); switchView('chat'); 
}
socket.on('rooms_data', (rooms) => { allRooms = rooms; updateRoomListUI(); });
function updateRoomListUI() {
    const list = document.getElementById('roomList'); list.innerHTML = `<div class="room-item ${(currentRoomId === 'global' && !currentDmTarget)?'active':''} ${unreadRooms.has('global')?'unread':''}" onclick="joinRoom('global')"><span class="room-name">Salon Global</span></div>`;
    allRooms.forEach(room => {
        const delBtn = IS_ADMIN ? `<button class="btn-del-room" onclick="event.stopPropagation(); deleteRoom('${room._id}')">✕</button>` : '';
        const isUnread = unreadRooms.has(room._id) ? 'unread' : ''; const isActive = (currentRoomId === room._id && !currentDmTarget) ? 'active' : '';
        list.innerHTML += `<div class="room-item ${isActive} ${isUnread}" onclick="joinRoom('${room._id}')"><span class="room-name">${room.name}</span>${delBtn}</div>`;
    });
}
function startDmFromList(targetUsername) { if (targetUsername === USERNAME) return alert("C'est vous !"); socket.emit('start_dm', targetUsername); }
socket.on('open_dm_ui', (targetUsername) => { openDm(targetUsername); });
function openDm(targetUsername) {
    currentDmTarget = targetUsername; currentRoomId = null; 
    if (!dmContacts.includes(targetUsername)) dmContacts.push(targetUsername);
    if (unreadDms.has(targetUsername)) unreadDms.delete(targetUsername);
    document.getElementById('currentRoomName').textContent = `@${targetUsername}`; document.getElementById('currentRoomName').style.color = "#7d5bc4"; 
    document.getElementById('messages').innerHTML = ""; document.getElementById('typing-indicator').classList.add('hidden');
    document.getElementById('charSelector').style.display = 'none'; document.getElementById('dm-header-actions').classList.remove('hidden'); 
    cancelContext(); socket.emit('request_dm_history', { myUsername: USERNAME, targetUsername: targetUsername });
    updateRoomListUI(); updateDmListUI(); switchView('chat'); 
    if(window.innerWidth <= 768) { document.getElementById('sidebar').classList.remove('open'); document.getElementById('mobile-overlay').classList.remove('open'); }
}
function closeCurrentDm() { if(!currentDmTarget) return; dmContacts = dmContacts.filter(c => c !== currentDmTarget); joinRoom('global'); }
function deleteCurrentDmHistory() { if(!currentDmTarget) return; if(confirm(`Supprimer TOUT l'historique avec ${currentDmTarget} ?`)) { socket.emit('delete_dm_history', { myUsername: USERNAME, targetUsername: currentDmTarget }); } }
socket.on('dm_history_deleted', (target) => { if(currentDmTarget === target) document.getElementById('messages').innerHTML = "<div style='text-align:center; color:#da373c; margin-top:20px;'><i>Historique supprimé.</i></div>"; });
socket.on('dm_contacts_data', (contacts) => { dmContacts = contacts; updateDmListUI(); });
function updateDmListUI() {
    const list = document.getElementById('dmList'); list.innerHTML = "";
    dmContacts.forEach(contact => {
        const isActive = (currentDmTarget === contact) ? 'active' : ''; const isUnread = unreadDms.has(contact) ? 'unread' : '';
        const avatarUrl = `https://ui-avatars.com/api/?name=${contact}&background=random&color=fff&size=64`;
        list.innerHTML += `<div class="dm-item ${isActive} ${isUnread}" onclick="openDm('${contact}')"><img src="${avatarUrl}" class="dm-avatar"><span>${contact}</span></div>`;
    });
}
socket.on('dm_history_data', (data) => { if (currentDmTarget !== data.target) return; const container = document.getElementById('messages'); container.innerHTML = ""; data.history.forEach(msg => { displayMessage(msg, true); }); scrollToBottom(); });
socket.on('receive_dm', (msg) => {
    const otherUser = (msg.sender === USERNAME) ? msg.target : msg.sender;
    if (!dmContacts.includes(otherUser)) { dmContacts.push(otherUser); updateDmListUI(); }
    if (currentDmTarget === otherUser) { displayMessage(msg, true); scrollToBottom(); } else { unreadDms.add(otherUser); updateDmListUI(); }
    if (msg.sender !== USERNAME) notifSound.play().catch(e=>{});
});
function createCharacter() {
    const name = document.getElementById('newCharName').value.trim(); const role = document.getElementById('newCharRole').value.trim(); const desc = document.getElementById('newCharDesc').value.trim(); const color = document.getElementById('newCharColor').value; let avatar = document.getElementById('newCharBase64').value;
    if(!avatar) avatar = `https://ui-avatars.com/api/?name=${name}&background=random`;
    if(!name || !role) return alert("Nom et Rôle requis");
    socket.emit('create_char', { name, role, color, avatar, description: desc, ownerId: PLAYER_ID });
    toggleCreateForm(); document.getElementById('newCharBase64').value = "";
}
function prepareEditCharacter(charId) {
    const char = myCharacters.find(c => c._id === charId); if (!char) return;
    document.getElementById('editCharId').value = char._id; document.getElementById('editCharOriginalName').value = char.name;
    document.getElementById('editCharName').value = char.name; document.getElementById('editCharRole').value = char.role;
    document.getElementById('editCharDesc').value = char.description; document.getElementById('editCharColor').value = char.color;
    document.getElementById('editCharBase64').value = ""; document.getElementById('edit-char-form').classList.remove('hidden'); document.getElementById('create-char-form').classList.add('hidden');
}
function cancelEditCharacter() { document.getElementById('edit-char-form').classList.add('hidden'); }
function submitEditCharacter() {
    const charId = document.getElementById('editCharId').value; const originalName = document.getElementById('editCharOriginalName').value; const newName = document.getElementById('editCharName').value.trim(); const newRole = document.getElementById('editCharRole').value.trim(); const newColor = document.getElementById('editCharColor').value; const newDesc = document.getElementById('editCharDesc').value.trim(); let newAvatar = document.getElementById('editCharBase64').value;
    if(!newAvatar) { const char = myCharacters.find(c => c._id === charId); if(char) newAvatar = char.avatar; }
    socket.emit('edit_char', { charId, originalName, newName, newRole, newAvatar, newColor, newDescription: newDesc, ownerId: PLAYER_ID, currentRoomId: currentRoomId }); cancelEditCharacter();
}
socket.on('my_chars_data', (chars) => { myCharacters = chars; updateUI(); });
socket.on('char_created_success', (char) => { myCharacters.push(char); updateUI(); });
function deleteCharacter(id) { if(confirm('Supprimer ?')) socket.emit('delete_char', id); }
socket.on('char_deleted_success', (id) => { myCharacters = myCharacters.filter(c => c._id !== id); updateUI(); });
function updateUI() {
    const list = document.getElementById('myCharList'); const select = document.getElementById('charSelector'); const selectFeed = document.getElementById('feedCharSelector'); let selectedCharId = null;
    if (select.selectedIndex >= 0) selectedCharId = select.options[select.selectedIndex].dataset.id; 
    list.innerHTML = ""; select.innerHTML = ""; selectFeed.innerHTML = "";
    if(IS_ADMIN) { const narr = '<option value="Narrateur" data-id="narrateur" data-color="#ffffff" data-avatar="https://cdn-icons-png.flaticon.com/512/1144/1144760.png" data-role="Omniscient">Narrateur</option>'; select.innerHTML = narr; selectFeed.innerHTML = narr; }
    myCharacters.forEach(char => {
        list.innerHTML += `<div class="char-item"><img src="${char.avatar}" class="mini-avatar"><div class="char-info"><div class="char-name-list" style="color:${char.color}">${char.name}</div><div class="char-role-list">${char.role}</div></div><div class="char-actions"><button class="btn-mini-action" onclick="prepareEditCharacter('${char._id}')">⚙️</button><button class="btn-mini-action" onclick="deleteCharacter('${char._id}')" style="color:#da373c;">✕</button></div></div>`;
        const opt = document.createElement('option'); opt.value = char.name; opt.text = char.name; opt.dataset.id = char._id; opt.dataset.color = char.color; opt.dataset.avatar = char.avatar; opt.dataset.role = char.role;
        select.appendChild(opt); selectFeed.appendChild(opt.cloneNode(true));
    });
    if(selectedCharId) { const optionToSelect = Array.from(select.options).find(o => o.dataset.id === selectedCharId); if(optionToSelect) optionToSelect.selected = true; else if (select.options.length > 0) select.selectedIndex = 0; }
}
function openProfile(charName) { socket.emit('get_char_profile', charName); }
function closeProfileModal() { document.getElementById('profile-modal').classList.add('hidden'); }
socket.on('char_profile_data', (char) => {
    document.getElementById('profileName').textContent = char.name; document.getElementById('profileRole').textContent = char.role;
    document.getElementById('profileAvatar').src = char.avatar; document.getElementById('profileDesc').textContent = char.description || "Aucune description.";
    document.getElementById('profileOwner').textContent = `Joué par : ${char.ownerUsername || "Inconnu"}`;
    document.getElementById('profile-modal').classList.remove('hidden');
    const btnDm = document.getElementById('btn-dm-profile'); btnDm.onclick = function() { closeProfileModal(); if (char.ownerUsername) openDm(char.ownerUsername); };
});
function setContext(type, data) {
    currentContext = { type, data }; const bar = document.getElementById('context-bar'); const icon = document.getElementById('context-icon'); const text = document.getElementById('context-text');
    bar.className = 'visible'; document.getElementById('txtInput').focus();
    if (type === 'reply') { icon.textContent = "↩️"; text.innerHTML = `Répondre à <strong>${data.author}</strong>`; }
    else if (type === 'edit') { icon.textContent = "✏️"; text.innerHTML = `Modifier message`; document.getElementById('txtInput').value = data.content; }
}
function cancelContext() { currentContext = null; document.getElementById('context-bar').className = 'hidden'; document.getElementById('txtInput').value = ""; }
function triggerReply(id, author, content) { setContext('reply', { id, author, content }); }
function triggerEdit(id, content) { setContext('edit', { id, content }); }
function triggerDelete(id) { if(confirm("Supprimer ?")) socket.emit('delete_message', id); }
function sendMessage() {
    const txt = document.getElementById('txtInput'); const content = txt.value.trim(); if (!content) return;
    if (currentDmTarget) { socket.emit('send_dm', { sender: USERNAME, target: currentDmTarget, content: content, type: "text", date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) }); txt.value = ''; cancelContext(); return; }
    if (content === "/clear") { if(IS_ADMIN) socket.emit('admin_clear_room', currentRoomId); txt.value = ''; return; }
    if (currentContext && currentContext.type === 'edit') { socket.emit('edit_message', { id: currentContext.data.id, newContent: content }); txt.value = ''; cancelContext(); return; }
    const sel = document.getElementById('charSelector'); if (sel.options.length === 0) { alert("Créez un personnage d'abord !"); return; }
    const opt = sel.options[sel.selectedIndex];
    socket.emit('message_rp', { content, type: "text", senderName: opt.value, senderColor: opt.dataset.color || "#fff", senderAvatar: opt.dataset.avatar, senderRole: opt.dataset.role, ownerId: PLAYER_ID, targetName: "", roomId: currentRoomId, date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}), replyTo: (currentContext && currentContext.type === 'reply') ? { id: currentContext.data.id, author: currentContext.data.author, content: currentContext.data.content } : null });
    txt.value = ''; cancelContext();
}
socket.on('history_data', (msgs) => { 
    if(currentDmTarget) return; 
    const container = document.getElementById('messages'); container.innerHTML = ""; 
    const splitId = firstUnreadMap[currentRoomId];
    msgs.forEach(msg => { if(splitId && msg._id === splitId) container.innerHTML += `<div class="new-msg-separator">-- Nouveaux --</div>`; displayMessage(msg); });
    if(firstUnreadMap[currentRoomId]) delete firstUnreadMap[currentRoomId];
    scrollToBottom(); 
});
socket.on('message_rp', (msg) => { 
    if (msg.ownerId !== PLAYER_ID) notifSound.play().catch(e => {});
    if(msg.roomId === currentRoomId && !currentDmTarget) { displayMessage(msg); scrollToBottom(); } 
    else { unreadRooms.add(msg.roomId); if (!firstUnreadMap[msg.roomId]) firstUnreadMap[msg.roomId] = msg._id; updateRoomListUI(); }
});
socket.on('message_deleted', (msgId) => { const el = document.getElementById(`msg-${msgId}`); if(el) el.remove(); });
socket.on('message_updated', (data) => { const el = document.getElementById(`content-${data.id}`); if(el) { el.innerHTML = formatText(data.newContent); const meta = el.parentElement.parentElement.querySelector('.timestamp'); if(!meta.textContent.includes('(modifié)')) meta.textContent += ' (modifié)'; } });
function formatText(text) { if(!text) return ""; return text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\*(.*?)\*/g, '<i>$1</i>').replace(/\|\|(.*?)\|\|/g, '<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>'); }
function getYoutubeId(url) { const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/); return (match && match[2].length === 11) ? match[2] : null; }
function displayMessage(msg, isDm = false) {
    const div = document.createElement('div'); div.className = 'message-container'; if(isDm) div.classList.add('dm-message'); div.id = `msg-${msg._id}`;
    let senderName, senderAvatar, senderColor, senderRole, canEdit = false, canDelete = false;
    if (isDm) { senderName = msg.sender; senderAvatar = `https://ui-avatars.com/api/?name=${msg.sender}&background=random&color=fff&size=64`; senderColor = "#dbdee1"; senderRole = "Utilisateur"; } 
    else { senderName = msg.senderName; senderAvatar = msg.senderAvatar; senderColor = msg.senderColor; senderRole = msg.senderRole; canEdit = (msg.ownerId === PLAYER_ID); canDelete = (msg.ownerId === PLAYER_ID) || IS_ADMIN; }
    let actionsHTML = "";
    if (!isDm) {
         actionsHTML += `<button class="action-btn" onclick="triggerReply('${msg._id}', '${senderName.replace(/'/g, "\\'")}', '${msg.content.replace(/'/g, "\\'")}')" title="Répondre">↩️</button>`;
         if (msg.type === 'text' && canEdit) actionsHTML += `<button class="action-btn" onclick="triggerEdit('${msg._id}', '${msg.content.replace(/'/g, "\\'")}')" title="Modifier">✏️</button>`;
         if (canDelete) actionsHTML += `<button class="action-btn" onclick="triggerDelete('${msg._id}')" style="color:#da373c;">🗑️</button>`;
    }
    let replyHTML = "", spacingStyle = "";
    if (msg.replyTo && msg.replyTo.author) { spacingStyle = "margin-top: 15px;"; replyHTML = `<div class="reply-spine"></div><div class="reply-context-line" style="margin-left: 55px;"><span class="reply-name">@${msg.replyTo.author}</span><span class="reply-text">${msg.replyTo.content}</span></div>`; }
    let contentHTML = "";
    if (msg.type === "image") contentHTML = `<img src="${msg.content}" class="chat-image" onclick="window.open(this.src)">`;
    else if (msg.type === "video") { const ytId = getYoutubeId(msg.content); if (ytId) contentHTML = `<iframe class="video-frame" src="https://www.youtube.com/embed/${ytId}" allowfullscreen></iframe>`; else if (msg.content.match(/\.(mp4|webm|ogg)$/i)) contentHTML = `<video class="video-direct" controls><source src="${msg.content}"></video>`; else contentHTML = `<div class="text-body"><a href="${msg.content}" target="_blank" style="color:var(--accent)">[Lien Vidéo] ${msg.content}</a></div>`; } 
    else contentHTML = `<div class="text-body" id="content-${msg._id}">${formatText(msg.content)}</div>`;
    const editedTag = msg.edited ? '<span class="edited-tag">(modifié)</span>' : ''; const avatarClick = isDm ? "" : `onclick="openProfile('${senderName.replace(/'/g, "\\'")}')"`;
    div.innerHTML = `${replyHTML}<div class="msg-actions">${actionsHTML}</div><div style="position:relative; ${spacingStyle}"><img src="${senderAvatar}" class="avatar-img" ${avatarClick}><div style="margin-left: 55px;"><div class="char-header"><span class="char-name" style="color: ${senderColor}" ${avatarClick}>${senderName}</span><span class="char-role">${senderRole || ""}</span><span class="timestamp">${msg.date} ${editedTag}</span></div>${contentHTML}</div></div>`;
    document.getElementById('messages').appendChild(div);
}
function scrollToBottom() { const d = document.getElementById('messages'); d.scrollTop = d.scrollHeight; }
document.getElementById('txtInput').addEventListener('keyup', (e) => { if(e.key === 'Enter') sendMessage(); });

// --- SOCIAL FEED LOGIC ---
function loadFeed() { socket.emit('request_feed'); }
document.getElementById('postContent').addEventListener('input', (e) => { document.getElementById('char-count').textContent = `${e.target.value.length}/1000`; });

function submitPost() {
    const content = document.getElementById('postContent').value.trim();
    if(!content || content.length > 1000) return alert("Message vide ou trop long (max 1000).");
    const mediaUrl = document.getElementById('postMediaUrl').value.trim();
    let mediaType = null;
    if(mediaUrl) { if(getYoutubeId(mediaUrl) || mediaUrl.match(/\.(mp4|webm|ogg)$/i)) mediaType = 'video'; else mediaType = 'image'; }
    const sel = document.getElementById('feedCharSelector'); if(sel.options.length === 0) return alert("Créez un personnage d'abord !");
    const opt = sel.options[sel.selectedIndex];
    const postData = { authorName: opt.value, authorAvatar: opt.dataset.avatar, authorRole: opt.dataset.role, content: content, mediaUrl: mediaUrl, mediaType: mediaType, date: new Date().toLocaleDateString() };
    socket.emit('new_post', postData);
    document.getElementById('postContent').value = ""; document.getElementById('postMediaUrl').value = ""; document.getElementById('char-count').textContent = "0/1000";
}

function toggleLike(postId) { if(!PLAYER_ID) return alert("Connectez-vous !"); socket.emit('like_post', { postId, userId: PLAYER_ID }); }
function deletePost(postId) { if(confirm("Supprimer ce post ?")) socket.emit('delete_post', postId); }

// --- NOUVELLE VUE DETAIL (FULL PAGE) ---
function openPostDetail(postId) {
    const postEl = document.getElementById(`post-${postId}`);
    if(!postEl) return;
    currentDetailPostId = postId;
    
    // Switch views
    document.getElementById('feed-main-view').classList.add('hidden');
    document.getElementById('single-post-view').classList.remove('hidden');

    // Clone content to display in full page
    const contentClone = postEl.cloneNode(true);
    contentClone.onclick = null; // Remove onclick trigger
    contentClone.style.border = "none"; 
    contentClone.style.background = "transparent"; // Blend in
    contentClone.classList.remove('highlight-new');
    
    // Hide original actions/comments parts from clone to avoid duplicates if needed, or re-render cleaner
    // Ici on garde la carte telle quelle mais on cache la liste des comments interne car on utilise celle du bas
    const hiddenList = contentClone.querySelector('.comments-list');
    if(hiddenList) hiddenList.remove();
    
    const detailContent = document.getElementById('single-post-content');
    detailContent.innerHTML = "";
    detailContent.appendChild(contentClone);
    
    // Populate comments
    const commentsListDiv = document.getElementById('post-detail-comments-list');
    const feedComments = postEl.querySelector('.comments-list')?.innerHTML || "";
    commentsListDiv.innerHTML = feedComments;
    
    // Handler nouveau commentaire
    document.getElementById('btn-detail-comment').onclick = () => {
        const txt = document.getElementById('post-detail-comment-input').value.trim();
        if(!txt) return;
        const sel = document.getElementById('feedCharSelector');
        if(sel.options.length === 0) return alert("Perso requis");
        socket.emit('comment_post', { postId, author: sel.options[sel.selectedIndex].value, content: txt, date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) });
        document.getElementById('post-detail-comment-input').value = "";
    };
}

function closePostDetail() {
    document.getElementById('single-post-view').classList.add('hidden');
    document.getElementById('feed-main-view').classList.remove('hidden');
    currentDetailPostId = null;
}

function deleteComment(postId, commentId) { if(confirm("Supprimer commentaire ?")) socket.emit('delete_comment', { postId, commentId }); }

// SOCKET FEED
socket.on('feed_data', (posts) => {
    const container = document.getElementById('feed-stream'); container.innerHTML = "";
    posts.forEach(post => container.appendChild(createPostElement(post)));
});
socket.on('new_post_added', (post) => {
    if(currentView !== 'feed') document.getElementById('feed-notif-dot').classList.remove('hidden');
    const container = document.getElementById('feed-stream'); const el = createPostElement(post);
    if(currentView === 'feed' || new Date(post.timestamp) > lastFeedVisit) el.classList.add('highlight-new');
    container.prepend(el);
});
socket.on('post_updated', (post) => {
    const existing = document.getElementById(`post-${post._id}`);
    if(existing) existing.replaceWith(createPostElement(post));
    // Update Detail View if active
    if(currentDetailPostId === post._id) {
        // Update likes display in detail
        const detailLikeBtn = document.querySelector('#single-post-content .action-btn-ghost.like-btn');
        if(detailLikeBtn) {
            const isLiked = post.likes.includes(PLAYER_ID);
            detailLikeBtn.innerHTML = `❤️ ${post.likes.length}`;
            if(isLiked) detailLikeBtn.classList.add('liked'); else detailLikeBtn.classList.remove('liked');
        }
        // Update comments list
        document.getElementById('post-detail-comments-list').innerHTML = generateCommentsHTML(post.comments, post._id);
    }
});
socket.on('post_deleted', (postId) => {
    const el = document.getElementById(`post-${postId}`); if(el) el.remove();
    if(currentDetailPostId === postId) closePostDetail();
});

function generateCommentsHTML(comments, postId) {
    let html = "";
    comments.forEach(c => {
        const delBtn = IS_ADMIN ? `<span style="color:#da373c; cursor:pointer; margin-left:10px;" onclick="deleteComment('${postId}', '${c._id}')">✕</span>` : "";
        html += `<div class="comment-item">
            <div class="comment-bubble">
                <div class="comment-meta"><span class="comment-author">${c.author}</span><span>${c.date}</span></div>
                <div>${c.content} ${delBtn}</div>
            </div>
        </div>`;
    });
    return html;
}

function createPostElement(post) {
    const div = document.createElement('div'); div.className = 'post-card'; div.id = `post-${post._id}`;
    const isLiked = post.likes.includes(PLAYER_ID); const likeClass = isLiked ? 'liked' : '';
    const adminDelBtn = IS_ADMIN ? `<button class="action-btn-ghost delete" style="position:absolute; top:10px; right:10px;" onclick="event.stopPropagation(); deletePost('${post._id}')">🗑️</button>` : '';
    let mediaHTML = "";
    if(post.mediaUrl) {
        if(post.mediaType === 'video') {
             const ytId = getYoutubeId(post.mediaUrl);
             if(ytId) mediaHTML = `<iframe class="post-media" src="https://www.youtube.com/embed/${ytId}" frameborder="0" allowfullscreen></iframe>`;
             else mediaHTML = `<video class="post-media" controls src="${post.mediaUrl}"></video>`;
        } else mediaHTML = `<img src="${post.mediaUrl}" class="post-media">`;
    }
    const commentsHTML = generateCommentsHTML(post.comments, post._id);
    div.innerHTML = `
        ${adminDelBtn}
        <div class="post-header" onclick="openProfile('${post.authorName.replace(/'/g, "\\'")}')">
            <img src="${post.authorAvatar}" class="post-avatar">
            <div class="post-meta">
                <span class="post-author">${post.authorName}</span>
                <span class="post-role">${post.authorRole}</span>
            </div>
            <span class="post-date">${post.date}</span>
        </div>
        <div class="post-content" onclick="openPostDetail('${post._id}')">${formatText(post.content)}</div>
        ${mediaHTML}
        <div class="post-actions">
            <button class="action-btn-ghost like-btn ${likeClass}" onclick="event.stopPropagation(); toggleLike('${post._id}')">❤️ ${post.likes.length}</button>
            <button class="action-btn-ghost" onclick="event.stopPropagation(); openPostDetail('${post._id}')">💬 ${post.comments.length}</button>
        </div>
        <div class="comments-list hidden">${commentsHTML}</div>
    `;
    return div;
}
