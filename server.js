const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { maxHttpBufferSize: 10e6 }); 
const mongoose = require('mongoose');

app.use(express.static(__dirname));

// CONFIGURATION
const ADMIN_CODE = "ADMIN"; 
const mongoURI = process.env.MONGO_URI; 

if (!mongoURI) console.error("ERREUR : Variable MONGO_URI manquante.");
else mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('Connecté à MongoDB.'))
    .catch(err => console.error("Erreur MongoDB:", err));

// --- SCHEMAS ---
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    secretCode: String, 
    isAdmin: { type: Boolean, default: false },
    uiTheme: { type: String, default: 'default' },
    ombraAlias: { type: String, default: null }
});
const User = mongoose.model('User', UserSchema);

const CharacterSchema = new mongoose.Schema({
    name: String, color: String, avatar: String, role: String, 
    ownerId: String, ownerUsername: String, description: String,
    followers: [String],
    partyName: String, partyLogo: String,
    isOfficial: { type: Boolean, default: false },
    companies: [{ name: String, logo: String, role: String, description: String }],
    // [NOUVEAU] Capital financier
    capital: { type: Number, default: 0 }
});
const Character = mongoose.model('Character', CharacterSchema);

// [NOUVEAU] Schéma alerte globale
const AlertSchema = new mongoose.Schema({
    message: String, color: { type: String, default: 'red' },
    active: { type: Boolean, default: true },
    timestamp: { type: Date, default: Date.now }
});
const Alert = mongoose.model('Alert', AlertSchema);

const MessageSchema = new mongoose.Schema({
    content: String, type: String, 
    senderName: String, senderColor: String, senderAvatar: String, senderRole: String, 
    partyName: String, partyLogo: String, ownerId: String, targetName: String, targetOwnerId: String,
    roomId: { type: String, required: true },
    replyTo: { id: String, author: String, content: String },
    edited: { type: Boolean, default: false },
    date: String, timestamp: { type: Date, default: Date.now },
    // [NOUVEAU] DM entre personnages
    isCharDm: { type: Boolean, default: false },
    senderCharId: String, targetCharId: String
});
const Message = mongoose.model('Message', MessageSchema);

const RoomSchema = new mongoose.Schema({
    name: { type: String, required: true }, creatorId: String, allowedCharacters: [String]
});
const Room = mongoose.model('Room', RoomSchema);

const PostSchema = new mongoose.Schema({
    content: String, mediaUrl: String, mediaType: String,
    authorCharId: String, authorName: String, authorAvatar: String, authorRole: String, authorColor: String, ownerId: String,
    partyName: String, partyLogo: String,
    likes: [String], 
    comments: [{ id: String, authorCharId: String, authorName: String, authorAvatar: String, content: String, mediaUrl: String, mediaType: String, ownerId: String, date: String }],
    date: String, timestamp: { type: Date, default: Date.now },
    isAnonymous: { type: Boolean, default: false },
    isBreakingNews: { type: Boolean, default: false },
    isArticle: { type: Boolean, default: false },
    isHeadline: { type: Boolean, default: false },
    urgencyLevel: { type: String, default: null },
    poll: { question: String, options: [{ text: String, voters: [String] }] }
});
const Post = mongoose.model('Post', PostSchema);

const OmbraMessageSchema = new mongoose.Schema({
    alias: String, content: String, date: String,
    ownerId: { type: String, default: null },
    timestamp: { type: Date, default: Date.now }
});
const OmbraMessage = mongoose.model('OmbraMessage', OmbraMessageSchema);

const EventSchema = new mongoose.Schema({
    jour: String, date: String, heure: String, evenement: String,
    timestamp: { type: Date, default: Date.now }
});
const Event = mongoose.model('Event', EventSchema);

const NotificationSchema = new mongoose.Schema({
    targetOwnerId: String, type: String, content: String, fromName: String,
    isRead: { type: Boolean, default: false }, timestamp: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', NotificationSchema);

// ========== [CITÉS] SCHÉMA ==========
const CitySchema = new mongoose.Schema({
    name:       { type: String, required: true, unique: true },
    archipel:   { type: String, default: 'Archipel Pacifique' },
    president:  { type: String, default: 'Vacant' },
    population: { type: Number, default: 500000 },
    baseEDC:    { type: Number, default: 1000000000000 }, // en milliards de défaut
    trend:      { type: String, default: 'stable' },
    flag:       { type: String, default: null }, // URL image du drapeau
    historyEDC: [{ value: Number, date: { type: Date, default: Date.now } }],
    updatedAt:  { type: Date, default: Date.now }
});
const City = mongoose.model('City', CitySchema);

const CITIES_SEED = [
    { name: 'Aguerta',    archipel: 'Archipel Pacifique' },
    { name: 'Arva',       archipel: 'Archipel Pacifique' },
    { name: 'Aurion',     archipel: 'Archipel Pacifique' },
    { name: 'Cellum',     archipel: 'Archipel Pacifique' },
    { name: 'Elvita',     archipel: 'Archipel Pacifique' },
    { name: 'Hoross',     archipel: 'Archipel Pacifique' },
    { name: 'Kama',       archipel: 'Archipel Pacifique' },
    { name: 'Lesetha',    archipel: 'Archipel Pacifique' },
    { name: 'Ofarno',     archipel: 'Archipel Pacifique' },
    { name: 'Orchadia',   archipel: 'Archipel Pacifique' },
    { name: 'Otima',      archipel: 'Archipel Pacifique' },
    { name: 'Qruving',    archipel: 'Archipel Pacifique' },
    { name: 'Shamballa',  archipel: 'Archipel Pacifique' },
    { name: 'Sioonok',    archipel: 'Archipel Pacifique' },
    { name: 'Tellos',     archipel: 'Archipel Pacifique' },
    { name: 'Tesmond',    archipel: 'Archipel Pacifique' },
    { name: 'Utopia',     archipel: 'Archipel Pacifique' },
    { name: 'Worford',    archipel: 'Archipel Pacifique' },
    { name: 'Burtharb',    archipel: 'Ancienne Archipel' },
    { name: 'Buswax',      archipel: 'Ancienne Archipel' },
    { name: 'Hertford',    archipel: 'Ancienne Archipel' },
    { name: 'Horsmouthia', archipel: 'Ancienne Archipel' },
    { name: 'Panviles',    archipel: 'Ancienne Archipel' },
    { name: 'Alburg',      archipel: 'Archipel Sableuse' },
    { name: 'Bambeween',   archipel: 'Archipel Sableuse' },
    { name: 'Bireland',    archipel: 'Archipel Sableuse' },
    { name: 'Kirchia',     archipel: 'Archipel Sableuse' },
    { name: 'Pagoas Sud',  archipel: 'Archipel Sableuse' },
    { name: 'Pagoas Nord', archipel: 'Archipel Sableuse' },
];
mongoose.connection.once('open', async () => {
    for(const c of CITIES_SEED) {
        const exists = await City.findOne({ name: c.name });
        if(!exists) await City.create({ ...c, baseEDC: 1000000000000, historyEDC: [{ value: 1000000000000 }] });
    }
});
// ========== [FIN CITÉS SCHÉMA] ==========

let onlineUsers = {}; 

function broadcastUserList() {
    const uniqueNames = [...new Set(Object.values(onlineUsers))];
    io.emit('update_user_list', uniqueNames);
}

async function createNotification(targetId, type, content, fromName) {
    if(!targetId || targetId === ADMIN_CODE) return;
    const notif = new Notification({ targetOwnerId: targetId, type, content, fromName });
    await notif.save();
    io.emit('notification_dispatch', notif); 
}

io.on('connection', async (socket) => {
  
  socket.on('login_request', async ({ username, code }) => {
      try {
          let user = await User.findOne({ username: username });
          const isAdmin = (code === ADMIN_CODE);
          if (user) {
              if (user.secretCode !== code && !isAdmin) return socket.emit('login_error', "Mot de passe incorrect.");
              if(isAdmin && !user.isAdmin) { user.isAdmin = true; await user.save(); }
          } else {
              const existingCode = await User.findOne({ secretCode: code });
              if(existingCode) return socket.emit('login_error', "Code déjà pris.");
              user = new User({ username, secretCode: code, isAdmin });
              await user.save();
          }
          await Character.updateMany({ ownerId: code }, { ownerUsername: username });
          // Générer alias Ombra persistant si absent
          if (!user.ombraAlias) {
              const num = Math.floor(Math.random() * 900) + 100;
              user.ombraAlias = `User#${num}`;
              await user.save();
          }
          onlineUsers[socket.id] = user.username;
          broadcastUserList();
          socket.emit('login_success', { username: user.username, userId: user.secretCode, isAdmin: user.isAdmin, uiTheme: user.uiTheme || 'default', ombraAlias: user.ombraAlias });
      } catch (e) { console.error(e); socket.emit('login_error', "Erreur serveur."); }
  });

  socket.on('change_username', async ({ userId, newUsername }) => {
      try {
          const existing = await User.findOne({ username: newUsername });
          if (existing) return socket.emit('username_change_error', "Pseudo pris.");
          await User.findOneAndUpdate({ secretCode: userId }, { username: newUsername });
          await Character.updateMany({ ownerId: userId }, { ownerUsername: newUsername });
          onlineUsers[socket.id] = newUsername;
          broadcastUserList();
          socket.emit('username_change_success', newUsername);
      } catch (e) { socket.emit('username_change_error', "Erreur."); }
  });

  socket.on('disconnect', () => { delete onlineUsers[socket.id]; broadcastUserList(); });

  socket.on('request_initial_data', async (userId) => {
      socket.emit('rooms_data', await Room.find());
      let posts = await Post.find({ isArticle: { $ne: true } }).sort({ timestamp: -1 }).limit(50);
      posts = posts.map(p => {
          let displayPost = p.toObject();
          if(displayPost.isAnonymous) {
              displayPost.authorName = "Source Anonyme";
              displayPost.authorAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%23383a40' width='100' height='100'/%3E%3Ctext x='50' y='55' font-size='50' fill='%23666' text-anchor='middle' dominant-baseline='middle'%3E%3F%3C/text%3E%3C/svg%3E";
              displayPost.authorRole = "Leak";
          }
          return displayPost;
      });
      socket.emit('feed_data', posts);
      // [NOUVEAU] Envoyer alerte active si existante
      const activeAlert = await Alert.findOne({ active: true }).sort({ timestamp: -1 });
      if(activeAlert) socket.emit('alert_data', activeAlert);
      
      if(userId) {
          const myChars = await Character.find({ ownerId: userId });
          socket.emit('my_chars_data', myChars);
          const notifs = await Notification.find({ targetOwnerId: userId }).sort({ timestamp: -1 }).limit(20);
          socket.emit('notifications_data', notifs);
      }
  });

  socket.on('get_char_profile', async (charName) => {
      const char = await Character.findOne({ name: charName }).sort({_id: -1});
      if(char) {
          const postCount = await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true } });
          const lastPosts = await Post.find({ authorCharId: char._id, isArticle: { $ne: true }, isAnonymous: { $ne: true } }).sort({ timestamp: -1 }).limit(5);
          const charData = char.toObject(); 
          charData.postCount = postCount;
          charData.lastPosts = lastPosts;
          socket.emit('char_profile_data', charData);
      }
  });

  socket.on('create_char', async (data) => {
    const count = await Character.countDocuments({ ownerId: data.ownerId });
    if (count >= 20) return; 
    const user = await User.findOne({ secretCode: data.ownerId });
    if (user) data.ownerUsername = user.username;
    const newChar = new Character(data);
    await newChar.save();
    socket.emit('char_created_success', newChar);
  });
  
  socket.on('edit_char', async (data) => {
      const updateData = { 
          name: data.newName, role: data.newRole, avatar: data.newAvatar, color: data.newColor, 
          description: data.newDescription, partyName: data.partyName, partyLogo: data.partyLogo, 
          isOfficial: data.isOfficial
      };
      // [NOUVEAU] Sauvegarder capital et entreprises si fournis
      if(data.capital !== undefined) updateData.capital = Number(data.capital) || 0;
      if(data.companies !== undefined) updateData.companies = data.companies;
      await Character.findByIdAndUpdate(data.charId, updateData);
      await Message.updateMany({ senderName: data.originalName, ownerId: data.ownerId }, { $set: { senderName: data.newName, senderRole: data.newRole, senderAvatar: data.newAvatar, senderColor: data.newColor }});
      await Post.updateMany({ authorName: data.originalName, ownerId: data.ownerId }, { $set: { authorName: data.newName, authorRole: data.newRole, authorAvatar: data.newAvatar, authorColor: data.newColor }});
      socket.emit('my_chars_data', await Character.find({ ownerId: data.ownerId }));
      io.emit('force_history_refresh', { roomId: data.currentRoomId });
      io.emit('reload_posts'); 
  });

  socket.on('delete_char', async (charId) => { await Character.findByIdAndDelete(charId); socket.emit('char_deleted_success', charId); });

  // [NOUVEAU] Admin ajoute une entreprise à un personnage
  socket.on('admin_add_company', async ({ charId, company }) => {
      const user = await User.findOne({ secretCode: Object.values(onlineUsers).find((v,i) => Object.keys(onlineUsers)[i] === socket.id) });
      // On valide que c'est bien le socket admin connecté
      const char = await Character.findByIdAndUpdate(
          charId,
          { $push: { companies: company } },
          { new: true }
      );
      if(char) {
          const postCount = await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true } });
          const lastPosts = await Post.find({ authorCharId: char._id, isArticle: { $ne: true }, isAnonymous: { $ne: true } }).sort({ timestamp: -1 }).limit(5);
          const charData = char.toObject(); charData.postCount = postCount; charData.lastPosts = lastPosts;
          io.emit('char_profile_data', charData);
      }
  });

  // [NOUVEAU] Admin supprime une entreprise d'un personnage
  socket.on('admin_remove_company', async ({ charId, companyIndex }) => {
      const char = await Character.findById(charId);
      if(!char) return;
      char.companies.splice(companyIndex, 1);
      await char.save();
      const postCount = await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true } });
      const lastPosts = await Post.find({ authorCharId: char._id, isArticle: { $ne: true }, isAnonymous: { $ne: true } }).sort({ timestamp: -1 }).limit(5);
      const charData = char.toObject(); charData.postCount = postCount; charData.lastPosts = lastPosts;
      io.emit('char_profile_data', charData);
  });

  // [NOUVEAU] Joueur modifie sa propre bio
  socket.on('update_char_bio', async ({ charId, bio, ownerId }) => {
      await Character.findOneAndUpdate({ _id: charId, ownerId: ownerId }, { description: bio });
      socket.emit('char_bio_updated', { charId, bio });
  });

  // [NOUVEAU] Admin modifie les stats (followers, likes)
  socket.on('admin_edit_followers', async ({ charId, count }) => {
      const char = await Character.findById(charId);
      if(!char) return;
      const current = char.followers.length;
      const diff = count - current;
      if(diff > 0) { for(let i=0;i<diff;i++) char.followers.push('fake_'+Date.now()+'_'+i); }
      else { char.followers = char.followers.slice(0, count < 0 ? 0 : count); }
      await char.save();
      socket.emit('char_profile_data', { ...char.toObject(), postCount: await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true } }), lastPosts: [] });
  });

  socket.on('admin_edit_post_likes', async ({ postId, count }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      const current = post.likes.length;
      const diff = count - current;
      if(diff > 0) { for(let i=0;i<diff;i++) post.likes.push('fake_like_'+Date.now()+'_'+i); }
      else { post.likes = post.likes.slice(0, count < 0 ? 0 : count); }
      await post.save();
      io.emit('post_updated', post);
  });

  // [NOUVEAU] Admin modifie le capital d'un personnage
  socket.on('admin_edit_capital', async ({ charId, capital }) => {
      await Character.findByIdAndUpdate(charId, { capital: Number(capital) || 0 });
      const char = await Character.findById(charId);
      if(char) {
          const postCount = await Post.countDocuments({ authorCharId: char._id, isArticle: { $ne: true } });
          const lastPosts = await Post.find({ authorCharId: char._id, isArticle: { $ne: true }, isAnonymous: { $ne: true } }).sort({ timestamp: -1 }).limit(5);
          const charData = char.toObject(); charData.postCount = postCount; charData.lastPosts = lastPosts;
          socket.emit('char_profile_data', charData);
      }
  });

  // [NOUVEAU] Bandeau d'alerte global (Admin)
  socket.on('admin_set_alert', async ({ message, color, active }) => {
      await Alert.deleteMany({});
      if(active && message) {
          const alert = new Alert({ message, color: color || 'red', active: true });
          await alert.save();
          io.emit('alert_data', alert);
      } else {
          io.emit('alert_cleared');
      }
  });

  // [NOUVEAU] DM entre personnages
  socket.on('send_char_dm', async (data) => {
      // data: { senderCharId, senderCharName, senderAvatar, senderColor, senderRole, targetCharId, targetCharName, targetOwnerId, ownerId, content, date }
      const roomId = `char_dm_${[data.senderCharId, data.targetCharId].sort().join('_')}`;
      const msg = new Message({
          content: data.content, type: 'text',
          senderName: data.senderCharName, senderColor: data.senderColor, senderAvatar: data.senderAvatar, senderRole: data.senderRole,
          ownerId: data.ownerId, targetName: data.targetCharName, targetOwnerId: data.targetOwnerId,
          roomId, isCharDm: true, senderCharId: data.senderCharId, targetCharId: data.targetCharId,
          date: data.date, timestamp: new Date()
      });
      const saved = await msg.save();
      const targetSockets = Object.entries(onlineUsers).filter(([,u]) => {
          return u === data.targetOwnerUsername;
      }).map(([id]) => id);
      const senderSockets = Object.entries(onlineUsers).filter(([,u]) => u === data.senderOwnerUsername).map(([id]) => id);
      [...new Set([...targetSockets, ...senderSockets])].forEach(sid => io.to(sid).emit('receive_char_dm', saved));
      await createNotification(data.targetOwnerId, 'reply', `(${data.senderCharName}) vous a envoyé un message`, data.senderCharName);
  });

  socket.on('request_char_dm_history', async ({ senderCharId, targetCharId }) => {
      const roomId = `char_dm_${[senderCharId, targetCharId].sort().join('_')}`;
      const msgs = await Message.find({ roomId, isCharDm: true }).sort({ timestamp: 1 }).limit(200);
      socket.emit('char_dm_history', { roomId, msgs });
  });

  socket.on('follow_character', async ({ followerCharId, targetCharId }) => {
      const targetChar = await Character.findById(targetCharId);
      const followerChar = await Character.findById(followerCharId);
      if(!targetChar || !followerChar || String(followerChar._id) === String(targetChar._id)) return;
      const index = targetChar.followers.indexOf(followerCharId);
      if(index === -1) { targetChar.followers.push(followerCharId); await createNotification(targetChar.ownerId, 'follow', `(${followerChar.name}) vous suit désormais`, followerChar.ownerUsername); } 
      else { targetChar.followers.splice(index, 1); }
      await targetChar.save();
      const charData = targetChar.toObject(); charData.postCount = await Post.countDocuments({ authorCharId: targetChar._id });
      socket.emit('char_profile_updated', charData);
  });

  socket.on('get_followers_list', async (targetCharId) => {
      const char = await Character.findById(targetCharId);
      if(char && char.followers.length > 0) socket.emit('followers_list_data', await Character.find({ _id: { $in: char.followers } }).select('name avatar role ownerUsername'));
      else socket.emit('followers_list_data', []);
  });

  socket.on('create_room', async (roomData) => { await new Room(roomData).save(); io.emit('rooms_data', await Room.find()); });
  socket.on('delete_room', async (roomId) => { if (roomId === "global") return; await Room.findByIdAndDelete(roomId); await Message.deleteMany({ roomId: roomId }); io.emit('rooms_data', await Room.find()); io.emit('force_room_exit', roomId); });
  socket.on('join_room', (roomId) => { socket.join(roomId); });
  socket.on('leave_room', (roomId) => { socket.leave(roomId); });
  
  socket.on('request_history', async (data) => {
      const roomId = (typeof data === 'object') ? data.roomId : data;
      const requesterId = (typeof data === 'object') ? data.userId : null;
      const query = { roomId: roomId };
      if (requesterId) query.$or = [ { targetName: { $exists: false } }, { targetName: "" }, { ownerId: requesterId }, { targetOwnerId: requesterId } ];
      else query.$or = [{ targetName: { $exists: false } }, { targetName: "" }];
      socket.emit('history_data', await Message.find(query).sort({ timestamp: 1 }).limit(200));
  });
  socket.on('request_dm_history', async ({ myUsername, targetUsername }) => {
      const messages = await Message.find({ roomId: 'dm', $or: [ { senderName: myUsername, targetName: targetUsername }, { senderName: targetUsername, targetName: myUsername } ] }).sort({ timestamp: 1 });
      socket.emit('dm_history_data', { target: targetUsername, history: messages });
  });
  socket.on('request_dm_contacts', async (username) => {
      const messages = await Message.find({ roomId: 'dm', $or: [{ senderName: username }, { targetName: username }] });
      const contacts = new Set(); messages.forEach(msg => { const other = (msg.senderName === username) ? msg.targetName : msg.senderName; if(other) contacts.add(other); });
      socket.emit('dm_contacts_data', Array.from(contacts));
  });
  socket.on('dm_delete_history', async ({ userId, targetName }) => {
      await Message.deleteMany({ $or: [ { ownerId: userId, targetName: targetName }, { targetName: targetName, ownerId: userId } ] }); 
      io.emit('force_history_refresh', { roomId: 'global' }); 
  });

  socket.on('send_dm', async (data) => {
      const senderUser = await User.findOne({ username: data.sender });
      const targetUser = await User.findOne({ username: data.target });
      const newMessage = new Message({ content: data.content, type: data.type, senderName: data.sender, ownerId: senderUser ? senderUser.secretCode : null, targetName: data.target, targetOwnerId: targetUser ? targetUser.secretCode : null, roomId: 'dm', date: data.date });
      const savedMsg = await newMessage.save();
      const payload = { _id: savedMsg._id, sender: savedMsg.senderName, target: savedMsg.targetName, content: savedMsg.content, type: savedMsg.type, date: savedMsg.date };
      const targetSockets = Object.keys(onlineUsers).filter(id => onlineUsers[id] === data.target);
      const senderSockets = Object.keys(onlineUsers).filter(id => onlineUsers[id] === data.sender);
      [...new Set([...targetSockets, ...senderSockets])].forEach(sockId => { io.to(sockId).emit('receive_dm', payload); });
      if (targetUser) await createNotification(targetUser.secretCode, 'reply', `vous a envoyé un message privé`, data.sender);
  });

  socket.on('message_rp', async (msgData) => {
    if (!msgData.roomId) return; 
    if (msgData.senderName === "Narrateur") { const user = await User.findOne({ secretCode: msgData.ownerId }); if (!user || !user.isAdmin) return; }
    if (msgData.targetName) { const targetChar = await Character.findOne({ name: msgData.targetName }).sort({_id: -1}); if (targetChar) msgData.targetOwnerId = targetChar.ownerId; }
    const savedMsg = await new Message(msgData).save();
    io.to(msgData.roomId).emit('message_rp', savedMsg);
    if (msgData.replyTo && msgData.replyTo.id) {
        const originalMsg = await Message.findById(msgData.replyTo.id);
        if (originalMsg && originalMsg.ownerId !== msgData.ownerId) await createNotification(originalMsg.ownerId, 'reply', `a répondu à votre message`, msgData.senderName);
    }
  });
  socket.on('delete_message', async (msgId) => { await Message.findByIdAndDelete(msgId); io.emit('message_deleted', msgId); });
  socket.on('edit_message', async (data) => { await Message.findByIdAndUpdate(data.id, { content: data.newContent, edited: true }); io.emit('message_updated', { id: data.id, newContent: data.newContent }); });
  socket.on('admin_clear_room', async (roomId) => { await Message.deleteMany({ roomId: roomId }); io.to(roomId).emit('history_cleared'); });

  socket.on('create_post', async (postData) => {
      const savedPost = await new Post(postData).save();
      let displayPost = savedPost.toObject();
      if(displayPost.isAnonymous) {
          displayPost.authorName = "Source Anonyme";
          displayPost.authorAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%23383a40' width='100' height='100'/%3E%3Ctext x='50' y='55' font-size='50' fill='%23666' text-anchor='middle' dominant-baseline='middle'%3E%3F%3C/text%3E%3C/svg%3E";
          displayPost.authorRole = "Leak";
      }
      if(displayPost.isArticle) {
          io.emit('new_article', displayPost);
      } else {
          io.emit('new_post', displayPost);
      }
      
      let authorChar = postData.authorCharId ? await Character.findById(postData.authorCharId) : null;
      if(authorChar && authorChar.followers.length > 0) {
          const followersChars = await Character.find({ _id: { $in: authorChar.followers } });
          const notifiedOwners = new Set();
          for(const f of followersChars) {
              if(!notifiedOwners.has(f.ownerId)) {
                  await createNotification(f.ownerId, 'follow', `(${postData.authorName}) a publié un post`, "Feed");
                  notifiedOwners.add(f.ownerId);
              }
          }
      }
  });

  socket.on('delete_post', async (postId) => { await Post.findByIdAndDelete(postId); io.emit('post_deleted', postId); });

  socket.on('like_post', async ({ postId, charId }) => { 
      const post = await Post.findById(postId);
      if(!post) return;
      const index = post.likes.indexOf(charId);
      let action = 'unlike';
      if(index === -1) { post.likes.push(charId); action = 'like'; } 
      else { post.likes.splice(index, 1); }
      await post.save();
      io.emit('post_updated', post);
      if (action === 'like' && post.ownerId) {
           const likerChar = await Character.findById(charId);
           await createNotification(post.ownerId, 'like', `(${likerChar ? likerChar.name : "Inconnu"}) a aimé votre post`, "Feed");
      }
  });

  socket.on('post_comment', async ({ postId, comment }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      comment.id = new mongoose.Types.ObjectId().toString();
      post.comments.push(comment);
      await post.save();
      io.emit('post_updated', post);
      if (post.ownerId !== comment.ownerId) await createNotification(post.ownerId, 'reply', `(${comment.authorName}) a commenté votre post`, "Feed");
  });
  socket.on('delete_comment', async ({ postId, commentId }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      post.comments = post.comments.filter(c => c.id !== commentId);
      await post.save();
      io.emit('post_updated', post);
  });

  socket.on('vote_poll', async ({ postId, optionIndex, charId }) => {
      const post = await Post.findById(postId);
      if(!post || !post.poll || !post.poll.options[optionIndex]) return;
      const option = post.poll.options[optionIndex];
      const voterIndex = option.voters.indexOf(charId);
      if(voterIndex === -1) option.voters.push(charId); else option.voters.splice(voterIndex, 1);
      await post.save();
      io.emit('post_updated', post);
  });

  socket.on('admin_inject_vote', async ({ postId, optionIndex, count }) => {
      const post = await Post.findById(postId);
      if(!post || !post.poll || !post.poll.options[optionIndex]) return;
      const loopCount = count || 1;
      for (let i = 0; i < loopCount; i++) {
          const fakeId = 'injected_' + Date.now() + '_' + Math.random().toString(36).substr(2,5) + i;
          post.poll.options[optionIndex].voters.push(fakeId);
      }
      await post.save();
      io.emit('post_updated', post);
  });
  
  socket.on('mark_notifications_read', async (userId) => { await Notification.updateMany({ targetOwnerId: userId, isRead: false }, { isRead: true }); socket.emit('notifications_read_confirmed'); });
  socket.on('typing_start', (data) => { socket.to(data.roomId).emit('display_typing', data); });
  socket.on('typing_stop', (data) => { socket.to(data.roomId).emit('hide_typing', data); });
  
  socket.on('save_theme', async ({ userId, theme }) => {
      await User.findOneAndUpdate({ secretCode: userId }, { uiTheme: theme });
      socket.emit('theme_saved', theme);
  });

  socket.on('typing_feed_start', (data) => { socket.broadcast.emit('display_feed_typing', data); });
  socket.on('typing_feed_stop', (data) => { socket.broadcast.emit('hide_feed_typing', data); });

  // PRESSE
  socket.on('request_presse', async () => {
      const articles = await Post.find({ isArticle: true }).sort({ isHeadline: -1, timestamp: -1 }).limit(50);
      socket.emit('presse_data', articles);
  });

  socket.on('set_headline', async ({ postId, value }) => {
      const user = await User.findOne({ secretCode: Object.keys(onlineUsers).includes(socket.id) ? null : null });
      // On vérifie admin via le socket
      await Post.updateMany({ isHeadline: true }, { isHeadline: false });
      if(value) await Post.findByIdAndUpdate(postId, { isHeadline: true });
      const articles = await Post.find({ isArticle: true }).sort({ isHeadline: -1, timestamp: -1 }).limit(50);
      io.emit('presse_data', articles);
  });

  // ACTUALITÉS
  socket.on('request_events', async () => {
      const events = await Event.find().sort({ date: 1, heure: 1 });
      socket.emit('events_data', events);
  });
  socket.on('create_event', async (data) => {
      const ev = new Event(data);
      await ev.save();
      io.emit('events_data', await Event.find().sort({ date: 1, heure: 1 }));
  });
  socket.on('delete_event', async (id) => {
      await Event.findByIdAndDelete(id);
      io.emit('events_data', await Event.find().sort({ date: 1, heure: 1 }));
  });

  // OMBRA
  socket.on('ombra_join', async ({ alias }) => {
      socket.join('ombra');
      const history = await OmbraMessage.find().sort({ timestamp: -1 }).limit(60);
      socket.emit('ombra_history', history.reverse());
  });
  socket.on('ombra_leave', () => { socket.leave('ombra'); });
  socket.on('ombra_message', async ({ alias, content, date, ownerId }) => {
      if(!alias || !content) return;
      const msg = new OmbraMessage({ alias, content, date, ownerId: ownerId || null });
      await msg.save();
      io.to('ombra').emit('ombra_message', { _id: msg._id.toString(), alias, content, date, ownerId: msg.ownerId });
  });
  socket.on('ombra_delete_message', async ({ msgId, requesterId }) => {
      const msg = await OmbraMessage.findById(msgId);
      if(!msg) return;
      const user = await User.findOne({ secretCode: requesterId });
      if(!user) return;
      if(msg.ownerId === requesterId || user.isAdmin) {
          await OmbraMessage.findByIdAndDelete(msgId);
          io.to('ombra').emit('ombra_message_deleted', msgId);
      }
  });

  // Personnages de tous les utilisateurs en ligne (pour sidebar droite)
  socket.on('request_all_chars_online', async () => {
      const onlineNames = new Set(Object.values(onlineUsers));
      const chars = await Character.find({ ownerUsername: { $in: Array.from(onlineNames) } });
      const result = chars.map(c => ({
          _id: c._id, name: c.name, avatar: c.avatar, color: c.color,
          role: c.role, ownerUsername: c.ownerUsername
      }));
      socket.emit('all_chars_online', result);
  });

  // Chercher des personnages (pour nouvelle conversation MP)
  socket.on('search_chars', async ({ query }) => {
      if(!query || query.length < 1) return socket.emit('chars_search_results', []);
      const chars = await Character.find({ name: { $regex: query, $options: 'i' } }).limit(10);
      socket.emit('chars_search_results', chars.map(c => ({
          _id: c._id, name: c.name, avatar: c.avatar, color: c.color,
          role: c.role, ownerId: c.ownerId, ownerUsername: c.ownerUsername
      })));
  });

  // ========== [CITÉS] SOCKET EVENTS ==========
  socket.on('request_cities', async () => {
      const cities = await City.find().sort({ archipel: 1, name: 1 });
      socket.emit('cities_data', cities);
  });

  socket.on('admin_update_city', async ({ cityId, president, population, baseEDC, trend, flag, customPct }) => {
      // Vérifier que l'expéditeur est admin
      const username = onlineUsers[socket.id];
      const user = username ? await User.findOne({ username }) : null;
      if(!user || !user.isAdmin) return;

      // Multiplicateurs réalistes (variations douces sur gros chiffres)
      const TREND_MULT = {
          croissance_forte: 1.015,  // +1,5 %
          croissance:       1.007,  // +0,7 %
          stable:           1.000,  // 0 %
          baisse:           0.993,  // -0,7 %
          chute:            0.985   // -1,5 %
      };

      const city = await City.findById(cityId);
      if(!city) return;

      if(president !== undefined && president !== null) city.president = president;
      if(population !== undefined && population !== null) city.population = Number(population);
      if(flag       !== undefined && flag !== null)       city.flag = flag;

      if(baseEDC !== undefined && baseEDC !== null) {
          city.baseEDC = Number(baseEDC);
          city.historyEDC.push({ value: Number(baseEDC), date: new Date() });
          if(city.historyEDC.length > 30) city.historyEDC.shift();
      }

      // Variation par tendance prédéfinie
      if(trend !== undefined && trend !== null) {
          city.trend = trend;
          const mult = TREND_MULT[trend] || 1;
          const newEDC = Math.round(city.baseEDC * mult);
          city.baseEDC = newEDC;
          city.historyEDC.push({ value: newEDC, date: new Date() });
          if(city.historyEDC.length > 30) city.historyEDC.shift();
      }

      // Variation par pourcentage personnalisé
      if(customPct !== undefined && customPct !== null) {
          const mult = 1 + (Number(customPct) / 100);
          const newEDC = Math.round(city.baseEDC * mult);
          city.baseEDC = Math.max(0, newEDC);
          city.historyEDC.push({ value: city.baseEDC, date: new Date() });
          if(city.historyEDC.length > 30) city.historyEDC.shift();
      }

      city.updatedAt = new Date();
      await city.save();

      const cities = await City.find().sort({ archipel: 1, name: 1 });
      io.emit('cities_data', cities);
  });
  // ========== [FIN CITÉS SOCKET] ==========
});

const port = process.env.PORT || 3000;
http.listen(port, () => { console.log(`Serveur prêt : ${port}`); });
