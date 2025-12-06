
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
    isAdmin: { type: Boolean, default: false }
});
const User = mongoose.model('User', UserSchema);

const CharacterSchema = new mongoose.Schema({
    name: String, color: String, avatar: String, role: String, 
    ownerId: String, ownerUsername: String, description: String,
    followers: [String] 
});
const Character = mongoose.model('Character', CharacterSchema);

const MessageSchema = new mongoose.Schema({
    content: String, type: String, 
    senderName: String, senderColor: String, senderAvatar: String, senderRole: String, ownerId: String,
    targetName: String, targetOwnerId: String,
    roomId: { type: String, required: true },
    replyTo: { id: String, author: String, content: String },
    edited: { type: Boolean, default: false },
    date: String, timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

const RoomSchema = new mongoose.Schema({
    name: { type: String, required: true }, creatorId: String, allowedCharacters: [String]
});
const Room = mongoose.model('Room', RoomSchema);

const PostSchema = new mongoose.Schema({
    content: String,
    mediaUrl: String,
    mediaType: String,
    authorCharId: String,
    authorName: String, authorAvatar: String, authorRole: String, authorColor: String, ownerId: String,
    likes: [String], 
    comments: [{
        id: String, authorCharId: String, authorName: String, authorAvatar: String, content: String, 
        mediaUrl: String, mediaType: String,
        ownerId: String, date: String,
        likes: [String] 
    }],
    date: String,
    timestamp: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', PostSchema);

const NotificationSchema = new mongoose.Schema({
    targetOwnerId: String, 
    type: String, 
    content: String,
    fromName: String,
    isRead: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', NotificationSchema);

// --- MUSIC SCHEMAS ---
const AlbumSchema = new mongoose.Schema({
    title: String,
    coverUrl: String,
    artistId: String, // Character ID
    artistName: String,
    year: String,
    ownerId: String
});
const Album = mongoose.model('Album', AlbumSchema);

const TrackSchema = new mongoose.Schema({
    title: String,
    audioUrl: String,
    coverUrl: String, // Can be album cover or single cover
    duration: Number, // In seconds
    albumId: String,
    artistId: String, // Character ID
    artistName: String,
    ownerId: String,
    plays: { type: Number, default: 0 },
    likes: [String], // Array of Character IDs
    timestamp: { type: Date, default: Date.now }
});
const Track = mongoose.model('Track', TrackSchema);


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
  
  // --- LOGIN ---
  socket.on('login_request', async ({ username, code }) => {
      try {
          let user = await User.findOne({ username: username });
          const isAdmin = (code === ADMIN_CODE);

          if (user) {
              if (user.secretCode !== code && !isAdmin) {
                  socket.emit('login_error', "Mot de passe incorrect.");
                  return;
              }
              if(isAdmin && !user.isAdmin) { user.isAdmin = true; await user.save(); }
          } else {
              const existingCode = await User.findOne({ secretCode: code });
              if(existingCode) {
                   socket.emit('login_error', "Code déjà pris.");
                   return;
              }
              user = new User({ username, secretCode: code, isAdmin });
              await user.save();
          }

          await Character.updateMany({ ownerId: code }, { ownerUsername: username });
          onlineUsers[socket.id] = user.username;
          broadcastUserList();

          socket.emit('login_success', { username: user.username, userId: user.secretCode, isAdmin: user.isAdmin });

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
      const posts = await Post.find().sort({ timestamp: -1 }).limit(50);
      socket.emit('feed_data', posts);
      
      if(userId) {
          const myChars = await Character.find({ ownerId: userId });
          socket.emit('my_chars_data', myChars);
          const notifs = await Notification.find({ targetOwnerId: userId }).sort({ timestamp: -1 }).limit(20);
          socket.emit('notifications_data', notifs);
      }
  });

  // --- PERSONNAGES & FOLLOWERS ---
  socket.on('get_char_profile', async (charName) => {
      const char = await Character.findOne({ name: charName }).sort({_id: -1});
      if(char) {
          const postCount = await Post.countDocuments({ authorCharId: char._id });
          const charData = char.toObject();
          charData.postCount = postCount;
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
      await Character.findByIdAndUpdate(data.charId, { 
          name: data.newName, role: data.newRole, avatar: data.newAvatar, color: data.newColor, description: data.newDescription 
      });
      await Message.updateMany({ senderName: data.originalName, ownerId: data.ownerId }, { $set: { senderName: data.newName, senderRole: data.newRole, senderAvatar: data.newAvatar, senderColor: data.newColor }});
      await Post.updateMany({ authorName: data.originalName, ownerId: data.ownerId }, { $set: { authorName: data.newName, authorRole: data.newRole, authorAvatar: data.newAvatar, authorColor: data.newColor }});
      await Track.updateMany({ artistId: data.charId }, { $set: { artistName: data.newName }}); // Update Music Artist Name
      
      const myChars = await Character.find({ ownerId: data.ownerId });
      socket.emit('my_chars_data', myChars);
      io.emit('force_history_refresh', { roomId: data.currentRoomId });
      io.emit('reload_posts'); 
      io.emit('reload_music');
  });

  socket.on('delete_char', async (charId) => {
      await Character.findByIdAndDelete(charId);
      socket.emit('char_deleted_success', charId);
  });

  socket.on('follow_character', async ({ followerCharId, targetCharId }) => {
      const targetChar = await Character.findById(targetCharId);
      const followerChar = await Character.findById(followerCharId);
      if(!targetChar || !followerChar) return;
      if(String(followerChar._id) === String(targetChar._id)) return; 

      const index = targetChar.followers.indexOf(followerCharId);
      if(index === -1) {
          targetChar.followers.push(followerCharId);
          await createNotification(targetChar.ownerId, 'follow', `(${followerChar.name}) vous suit désormais`, followerChar.ownerUsername);
      } else {
          targetChar.followers.splice(index, 1);
      }
      await targetChar.save();
      
      const postCount = await Post.countDocuments({ authorCharId: targetChar._id });
      const charData = targetChar.toObject();
      charData.postCount = postCount;
      socket.emit('char_profile_updated', charData);
  });

  socket.on('get_followers_list', async (targetCharId) => {
      const char = await Character.findById(targetCharId);
      if(char && char.followers.length > 0) {
          const followers = await Character.find({ _id: { $in: char.followers } }).select('name avatar role ownerUsername');
          socket.emit('followers_list_data', followers);
      } else {
          socket.emit('followers_list_data', []);
      }
  });

  // --- ROOMS ---
  socket.on('create_room', async (roomData) => { await new Room(roomData).save(); io.emit('rooms_data', await Room.find()); });
  socket.on('delete_room', async (roomId) => { if (roomId === "global") return; await Room.findByIdAndDelete(roomId); await Message.deleteMany({ roomId: roomId }); io.emit('rooms_data', await Room.find()); io.emit('force_room_exit', roomId); });
  socket.on('join_room', (roomId) => { socket.join(roomId); });
  socket.on('leave_room', (roomId) => { socket.leave(roomId); });
  
  // --- HISTORIQUE & MP ---
  socket.on('request_history', async (data) => {
      const roomId = (typeof data === 'object') ? data.roomId : data;
      const requesterId = (typeof data === 'object') ? data.userId : null;
      const query = { roomId: roomId };
      if (requesterId) { query.$or = [ { targetName: { $exists: false } }, { targetName: "" }, { ownerId: requesterId }, { targetOwnerId: requesterId } ]; } 
      else { query.$or = [{ targetName: { $exists: false } }, { targetName: "" }]; }
      const history = await Message.find(query).sort({ timestamp: 1 }).limit(200);
      socket.emit('history_data', history);
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

  // --- MESSAGES ---
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
    const newMessage = new Message(msgData);
    const savedMsg = await newMessage.save();
    io.to(msgData.roomId).emit('message_rp', savedMsg);
    if (msgData.replyTo && msgData.replyTo.id) {
        const originalMsg = await Message.findById(msgData.replyTo.id);
        if (originalMsg && originalMsg.ownerId !== msgData.ownerId) await createNotification(originalMsg.ownerId, 'reply', `a répondu à votre message`, msgData.senderName);
    }
  });
  socket.on('delete_message', async (msgId) => { await Message.findByIdAndDelete(msgId); io.emit('message_deleted', msgId); });
  socket.on('edit_message', async (data) => { await Message.findByIdAndUpdate(data.id, { content: data.newContent, edited: true }); io.emit('message_updated', { id: data.id, newContent: data.newContent }); });
  socket.on('admin_clear_room', async (roomId) => { await Message.deleteMany({ roomId: roomId }); io.to(roomId).emit('history_cleared'); });

  // --- POSTS (FEED) ---
  socket.on('create_post', async (postData) => {
      const newPost = new Post(postData);
      const savedPost = await newPost.save();
      io.emit('new_post', savedPost);
      
      let authorChar = null;
      if(postData.authorCharId) authorChar = await Character.findById(postData.authorCharId);
      
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
  socket.on('report_post', async (postId) => { console.log(`Post ${postId} signalé.`); });

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
           const name = likerChar ? likerChar.name : "Inconnu";
           await createNotification(post.ownerId, 'like', `(${name}) a aimé votre post`, "Feed");
      }
  });

  socket.on('like_comment', async ({ postId, commentId, charId }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      const comment = post.comments.find(c => c.id === commentId);
      if(!comment) return;

      if(!comment.likes) comment.likes = [];
      const index = comment.likes.indexOf(charId);
      
      if(index === -1) { comment.likes.push(charId); }
      else { comment.likes.splice(index, 1); }
      
      post.markModified('comments');
      await post.save();
      io.emit('post_updated', post);
  });

  socket.on('post_comment', async ({ postId, comment }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      comment.id = new mongoose.Types.ObjectId().toString();
      comment.likes = [];
      post.comments.push(comment);
      await post.save();
      io.emit('post_updated', post);
      
      if (post.ownerId !== comment.ownerId) {
          await createNotification(post.ownerId, 'reply', `(${comment.authorName}) a commenté votre post`, "Feed");
      }
  });

  socket.on('delete_comment', async ({ postId, commentId }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      post.comments = post.comments.filter(c => c.id !== commentId);
      await post.save();
      io.emit('post_updated', post);
  });
  
  // --- MUSIC / STREAM ---
  socket.on('upload_track', async (trackData) => {
      const newTrack = new Track(trackData);
      await newTrack.save();
      io.emit('track_uploaded', newTrack);
      
      // Notify Followers
      const artist = await Character.findById(trackData.artistId);
      if(artist && artist.followers.length > 0) {
          const followersChars = await Character.find({ _id: { $in: artist.followers } });
          const notifiedOwners = new Set();
          for(const f of followersChars) {
              if(!notifiedOwners.has(f.ownerId)) {
                  await createNotification(f.ownerId, 'follow', `(${trackData.artistName}) a sorti un nouveau son !`, "Music");
                  notifiedOwners.add(f.ownerId);
              }
          }
      }
  });

  socket.on('get_music_feed', async () => {
      const tracks = await Track.find().sort({ timestamp: -1 }).limit(50);
      socket.emit('music_feed_data', tracks);
  });

  socket.on('like_track', async ({ trackId, charId }) => {
      const track = await Track.findById(trackId);
      if(!track) return;
      const index = track.likes.indexOf(charId);
      if(index === -1) track.likes.push(charId);
      else track.likes.splice(index, 1);
      await track.save();
      io.emit('track_updated', track);
  });

  socket.on('listen_track', async (trackId) => {
      await Track.findByIdAndUpdate(trackId, { $inc: { plays: 1 } });
      const track = await Track.findById(trackId);
      io.emit('track_updated', track);
  });

  socket.on('delete_track', async (trackId) => {
      await Track.findByIdAndDelete(trackId);
      io.emit('track_deleted', trackId);
  });

  socket.on('mark_notifications_read', async (userId) => { await Notification.updateMany({ targetOwnerId: userId, isRead: false }, { isRead: true }); socket.emit('notifications_read_confirmed'); });
  socket.on('typing_start', (data) => { socket.to(data.roomId).emit('display_typing', data); });
  socket.on('typing_stop', (data) => { socket.to(data.roomId).emit('hide_typing', data); });
});

const port = process.env.PORT || 3000;
http.listen(port, () => { console.log(`Serveur prêt : ${port}`); });
