const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { maxHttpBufferSize: 10e6 }); 
const mongoose = require('mongoose');

app.use(express.static(__dirname));

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

const NotificationSchema = new mongoose.Schema({
    recipientId: String, type: String, content: String, triggerName: String, 
    read: { type: Boolean, default: false },
    date: String, timestamp: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', NotificationSchema);

const MessageSchema = new mongoose.Schema({
    content: String, type: String, // text, image, video, audio
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
    content: String, mediaUrl: String, mediaType: String,
    authorName: String, authorAvatar: String, authorRole: String, authorColor: String, ownerId: String,
    likes: [String],
    comments: [{
        id: String, authorName: String, authorAvatar: String, content: String, 
        ownerId: String, date: String, mediaUrl: String, mediaType: String
    }],
    date: String, timestamp: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', PostSchema);

let onlineUsers = {}; 

async function createNotification(recipientId, type, content, triggerName) {
    if(!recipientId || recipientId === "null") return;
    await new Notification({
        recipientId, type, content, triggerName,
        date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
    }).save();
    io.emit('notification_trigger', { recipientId });
}

function broadcastUserList() {
    const uniqueNames = [...new Set(Object.values(onlineUsers))];
    io.emit('update_user_list', uniqueNames);
}

io.on('connection', async (socket) => {
  socket.on('login_request', async ({ username, code }) => {
      try {
          let user = await User.findOne({ username: username });
          const isAdmin = (code === ADMIN_CODE);
          if (user) {
              if (user.secretCode !== code && !isAdmin) { socket.emit('login_error', "Mot de passe incorrect."); return; }
              if(isAdmin && !user.isAdmin) { user.isAdmin = true; await user.save(); }
          } else {
              const existingCode = await User.findOne({ secretCode: code });
              if(existingCode) { socket.emit('login_error', "Code pris par " + existingCode.username); return; }
              user = new User({ username, secretCode: code, isAdmin });
              await user.save();
          }
          await Character.updateMany({ ownerId: code }, { ownerUsername: username });
          onlineUsers[socket.id] = user.username;
          broadcastUserList();
          socket.emit('login_success', { username: user.username, userId: user.secretCode, isAdmin: user.isAdmin });
      } catch (e) { socket.emit('login_error', "Erreur serveur."); }
  });

  socket.on('disconnect', () => { delete onlineUsers[socket.id]; broadcastUserList(); });

  socket.on('request_initial_data', async (userId) => {
      socket.emit('rooms_data', await Room.find());
      socket.emit('feed_data', await Post.find().sort({ timestamp: -1 }).limit(50));
      if(userId) {
          socket.emit('my_chars_data', await Character.find({ ownerId: userId }));
          socket.emit('notifications_data', await Notification.find({ recipientId: userId }).sort({ timestamp: -1 }).limit(20));
      }
  });

  // PERSONNAGES
  socket.on('get_char_profile', async (charName) => {
      const char = await Character.findOne({ name: charName }).sort({_id: -1});
      if(char) socket.emit('char_profile_data', char);
  });
  socket.on('create_char', async (data) => {
    if ((await Character.countDocuments({ ownerId: data.ownerId })) >= 20) return; 
    const user = await User.findOne({ secretCode: data.ownerId });
    if (user) data.ownerUsername = user.username;
    data.followers = [];
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
      socket.emit('my_chars_data', await Character.find({ ownerId: data.ownerId }));
      io.emit('force_history_refresh', { roomId: data.currentRoomId });
      io.emit('reload_posts'); 
  });
  socket.on('delete_char', async (charId) => { await Character.findByIdAndDelete(charId); socket.emit('char_deleted_success', charId); });
  
  socket.on('follow_char', async ({ charId, userId }) => {
      const char = await Character.findById(charId);
      if(!char) return;
      const index = char.followers.indexOf(userId);
      if(index === -1) {
          char.followers.push(userId);
          if(char.ownerId !== userId) await createNotification(char.ownerId, 'follow', `suit ${char.name}`, (await User.findOne({secretCode:userId}))?.username || "Quelqu'un");
      } else char.followers.splice(index, 1);
      await char.save();
      socket.emit('char_profile_updated', char);
  });

  // NOTIFS
  socket.on('mark_notifications_read', async (userId) => {
      await Notification.updateMany({ recipientId: userId, read: false }, { read: true });
      socket.emit('notifications_data', await Notification.find({ recipientId: userId }).sort({ timestamp: -1 }).limit(20));
  });

  // ROOMS & MESSAGES
  socket.on('create_room', async (d) => { await new Room(d).save(); io.emit('rooms_data', await Room.find()); });
  socket.on('delete_room', async (id) => { if(id==="global")return; await Room.findByIdAndDelete(id); await Message.deleteMany({roomId:id}); io.emit('rooms_data', await Room.find()); io.emit('force_room_exit', id); });
  socket.on('join_room', (r) => socket.join(r));
  socket.on('leave_room', (r) => socket.leave(r));
  socket.on('request_history', async (d) => { socket.emit('history_data', await Message.find({ roomId: (d.roomId||d), targetName: { $exists: false } }).sort({ timestamp: 1 }).limit(200)); });
  
  socket.on('request_dm_history', async ({ myUsername, targetUsername }) => {
      socket.emit('dm_history_data', { target: targetUsername, history: await Message.find({ roomId: 'dm', $or: [{ senderName: myUsername, targetName: targetUsername }, { senderName: targetUsername, targetName: myUsername }] }).sort({ timestamp: 1 }) });
  });

  socket.on('message_rp', async (data) => {
    if (!data.roomId) return; 
    if (data.senderName === "Narrateur") { if (!(await User.findOne({ secretCode: data.ownerId }))?.isAdmin) return; }
    const savedMsg = await new Message(data).save();
    io.to(data.roomId).emit('message_rp', savedMsg); 
  });
  socket.on('send_dm', async (data) => {
      const savedMsg = await new Message({ ...data, roomId: 'dm', timestamp: Date.now() }).save();
      // Envoi manuel aux 2 concernés
      const sockets = Object.keys(onlineUsers).filter(id => onlineUsers[id] === data.senderName || onlineUsers[id] === data.targetName);
      sockets.forEach(s => io.to(s).emit('receive_dm', { ...savedMsg.toObject(), sender: savedMsg.senderName, target: savedMsg.targetName }));
  });
  socket.on('delete_message', async (id) => { await Message.findByIdAndDelete(id); io.emit('message_deleted', id); });

  // POSTS
  socket.on('create_post', async (data) => {
      const savedPost = await new Post(data).save();
      // Notif followers
      const char = await Character.findOne({ name: data.authorName, ownerId: data.ownerId });
      if(char && char.followers) {
          char.followers.forEach(fid => { if(fid !== data.ownerId) createNotification(fid, 'post', "Nouveau post", data.authorName); });
      }
      io.emit('new_post', savedPost);
  });
  socket.on('delete_post', async (id) => { await Post.findByIdAndDelete(id); io.emit('post_deleted', id); });
  socket.on('like_post', async ({ postId, userId }) => {
      const post = await Post.findById(postId); if(!post) return;
      const idx = post.likes.indexOf(userId);
      if(idx === -1) { post.likes.push(userId); if(post.ownerId !== userId) await createNotification(post.ownerId, 'like', "a aimé votre post", (await User.findOne({secretCode:userId}))?.username); }
      else post.likes.splice(idx, 1);
      await post.save(); io.emit('post_updated', post);
  });
  socket.on('post_comment', async ({ postId, comment }) => {
      const post = await Post.findById(postId); if(!post) return;
      comment.id = new mongoose.Types.ObjectId().toString();
      post.comments.push(comment);
      if(post.ownerId !== comment.ownerId) await createNotification(post.ownerId, 'comment', "a commenté", comment.authorName);
      await post.save(); io.emit('post_updated', post);
  });
  socket.on('delete_comment', async ({ postId, commentId }) => {
      const post = await Post.findById(postId); if(!post) return;
      post.comments = post.comments.filter(c => c.id !== commentId);
      await post.save(); io.emit('post_updated', post);
  });

  socket.on('typing_start', (d) => socket.to(d.roomId).emit('display_typing', d));
  socket.on('typing_stop', (d) => socket.to(d.roomId).emit('hide_typing', d));
});

const port = process.env.PORT || 3000;
http.listen(port, () => { console.log(`Serveur prêt : ${port}`); });
