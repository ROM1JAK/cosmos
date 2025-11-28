const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { maxHttpBufferSize: 5e6 });
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
    name: String, color: String, avatar: String, role: String, ownerId: String, ownerUsername: String, description: String 
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

const DirectMessageSchema = new mongoose.Schema({
    sender: String, target: String, content: String,
    type: { type: String, default: "text" },
    date: String, timestamp: { type: Date, default: Date.now }
});
const DirectMessage = mongoose.model('DirectMessage', DirectMessageSchema);

// Schema FEED / POSTS (Mise à jour)
const PostSchema = new mongoose.Schema({
    authorName: String,
    authorAvatar: String,
    authorRole: String,
    content: String,
    mediaUrl: String, // Nouveau: URL image/vidéo
    mediaType: String, // 'image' ou 'video'
    date: String,
    timestamp: { type: Date, default: Date.now },
    likes: [String], 
    comments: [{
        _id: { type: mongoose.Schema.Types.ObjectId, auto: true }, // ID unique pour suppression
        author: String, 
        content: String,
        date: String
    }]
});
const Post = mongoose.model('Post', PostSchema);

let onlineUsers = {}; 

function broadcastUserList() {
    const uniqueNames = [...new Set(Object.values(onlineUsers))];
    io.emit('update_user_list', uniqueNames);
}

io.on('connection', async (socket) => {
  
  // --- LOGIN ---
  socket.on('login_request', async ({ username, code }) => {
      try {
          let user = await User.findOne({ username: username });
          const isAdmin = (code === ADMIN_CODE);

          if (user) {
              if (user.secretCode !== code && !isAdmin) {
                  socket.emit('login_error', "Mot de passe incorrect pour ce pseudo !");
                  return;
              }
              if(isAdmin && !user.isAdmin) { user.isAdmin = true; await user.save(); }
          } else {
              const existingCode = await User.findOne({ secretCode: code });
              if(existingCode) {
                   socket.emit('login_error', "Ce Code Secret est déjà lié à un autre pseudo (" + existingCode.username + ").");
                   return;
              }
              user = new User({ username, secretCode: code, isAdmin });
              await user.save();
          }

          await Character.updateMany({ ownerId: code }, { ownerUsername: username });
          onlineUsers[socket.id] = user.username;
          broadcastUserList();

          socket.emit('login_success', { 
              username: user.username, userId: user.secretCode, isAdmin: user.isAdmin 
          });

      } catch (e) {
          console.error("Erreur Login:", e);
          socket.emit('login_error', "Erreur serveur.");
      }
  });

  socket.on('change_username', async ({ userId, newUsername }) => {
      try {
          const existing = await User.findOne({ username: newUsername });
          if (existing) {
              socket.emit('username_change_error', "Ce pseudo est déjà pris.");
              return;
          }
          await User.findOneAndUpdate({ secretCode: userId }, { username: newUsername });
          await Character.updateMany({ ownerId: userId }, { ownerUsername: newUsername });
          
          onlineUsers[socket.id] = newUsername;
          broadcastUserList();
          socket.emit('username_change_success', newUsername);
      } catch (e) {
          socket.emit('username_change_error', "Erreur lors du changement de pseudo.");
      }
  });

  socket.on('disconnect', () => {
      delete onlineUsers[socket.id];
      broadcastUserList();
  });

  socket.on('request_initial_data', async (userId) => {
      socket.emit('rooms_data', await Room.find());
      if(userId) {
          const myChars = await Character.find({ ownerId: userId });
          socket.emit('my_chars_data', myChars);
      }
  });

  // --- PERSONNAGES ---
  socket.on('get_char_profile', async (charName) => {
      const char = await Character.findOne({ name: charName }).sort({_id: -1});
      if(char) socket.emit('char_profile_data', char);
  });

  socket.on('create_char', async (data) => {
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
      await Message.updateMany(
          { senderName: data.originalName, ownerId: data.ownerId },
          { $set: { senderName: data.newName, senderRole: data.newRole, senderAvatar: data.newAvatar, senderColor: data.newColor }}
      );
      const myChars = await Character.find({ ownerId: data.ownerId });
      socket.emit('my_chars_data', myChars);
      io.emit('force_history_refresh', { roomId: data.currentRoomId });
  });

  socket.on('delete_char', async (charId) => {
      await Character.findByIdAndDelete(charId);
      socket.emit('char_deleted_success', charId);
  });

  // --- ROOMS & CHAT ---
  socket.on('create_room', async (roomData) => {
      await new Room(roomData).save();
      io.emit('rooms_data', await Room.find());
  });
  socket.on('delete_room', async (roomId) => {
      if (roomId === "global") return; 
      await Room.findByIdAndDelete(roomId);
      await Message.deleteMany({ roomId: roomId });
      io.emit('rooms_data', await Room.find());
      io.emit('force_room_exit', roomId);
  });
  socket.on('join_room', (roomId) => { socket.join(roomId); });
  socket.on('leave_room', (roomId) => { socket.leave(roomId); });
  
  socket.on('request_history', async (data) => {
      const roomId = (typeof data === 'object') ? data.roomId : data;
      const requesterId = (typeof data === 'object') ? data.userId : null;
      const query = { roomId: roomId };
      if (requesterId) {
          query.$or = [{ targetName: { $exists: false } }, { targetName: "" }, { ownerId: requesterId }, { targetOwnerId: requesterId }];
      } else {
          query.$or = [{ targetName: { $exists: false } }, { targetName: "" }];
      }
      const history = await Message.find(query).sort({ timestamp: 1 }).limit(200);
      socket.emit('history_data', history);
  });

  socket.on('message_rp', async (msgData) => {
    if (!msgData.roomId) return; 
    if (msgData.senderName === "Narrateur") {
        const user = await User.findOne({ secretCode: msgData.ownerId });
        if (!user || !user.isAdmin) return;
    }
    if (msgData.targetName) {
        const targetChar = await Character.findOne({ name: msgData.targetName }).sort({_id: -1});
        if (targetChar) msgData.targetOwnerId = targetChar.ownerId;
    }
    const newMessage = new Message(msgData);
    const savedMsg = await newMessage.save();
    io.to(msgData.roomId).emit('message_rp', savedMsg); 
  });

  socket.on('delete_message', async (msgId) => {
      await Message.findByIdAndDelete(msgId);
      io.emit('message_deleted', msgId);
  });
  socket.on('edit_message', async (data) => {
      await Message.findByIdAndUpdate(data.id, { content: data.newContent, edited: true });
      io.emit('message_updated', { id: data.id, newContent: data.newContent });
  });
  socket.on('admin_clear_room', async (roomId) => {
      await Message.deleteMany({ roomId: roomId });
      io.to(roomId).emit('history_cleared');
  });

  // --- GESTION DES MP ---
  socket.on('send_dm', async (data) => {
      const newDm = new DirectMessage(data);
      await newDm.save();
      const targetSockets = Object.keys(onlineUsers).filter(id => onlineUsers[id] === data.target);
      const senderSockets = Object.keys(onlineUsers).filter(id => onlineUsers[id] === data.sender);
      [...targetSockets, ...senderSockets].forEach(sId => { io.to(sId).emit('receive_dm', newDm); });
  });

  socket.on('request_dm_history', async ({ myUsername, targetUsername }) => {
      const history = await DirectMessage.find({
          $or: [ { sender: myUsername, target: targetUsername }, { sender: targetUsername, target: myUsername } ]
      }).sort({ timestamp: 1 }).limit(100);
      socket.emit('dm_history_data', { history, target: targetUsername });
  });

  socket.on('request_dm_contacts', async (username) => {
      const msgs = await DirectMessage.find({ $or: [{ sender: username }, { target: username }] });
      const contacts = new Set();
      msgs.forEach(m => {
          if (m.sender === username) contacts.add(m.target);
          else contacts.add(m.sender);
      });
      socket.emit('dm_contacts_data', Array.from(contacts));
  });
  
  // Suppression historique MP
  socket.on('delete_dm_history', async ({ myUsername, targetUsername }) => {
      await DirectMessage.deleteMany({
          $or: [ { sender: myUsername, target: targetUsername }, { sender: targetUsername, target: myUsername } ]
      });
      // Notifier les deux parties
      const targetSockets = Object.keys(onlineUsers).filter(id => onlineUsers[id] === targetUsername);
      const senderSockets = Object.keys(onlineUsers).filter(id => onlineUsers[id] === myUsername);
      [...targetSockets, ...senderSockets].forEach(sId => { io.to(sId).emit('dm_history_deleted', targetUsername); });
  });

  socket.on('start_dm', (targetUsername) => { socket.emit('open_dm_ui', targetUsername); });

  // --- FEED / SOCIAL NETWORK ---
  
  socket.on('request_feed', async () => {
      const posts = await Post.find().sort({ timestamp: -1 }).limit(50);
      socket.emit('feed_data', posts);
  });

  socket.on('new_post', async (postData) => {
      const newPost = new Post(postData);
      const savedPost = await newPost.save();
      io.emit('new_post_added', savedPost);
  });

  socket.on('delete_post', async (postId) => {
      await Post.findByIdAndDelete(postId);
      io.emit('post_deleted', postId);
  });

  socket.on('like_post', async ({ postId, userId }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      if (post.likes.includes(userId)) post.likes = post.likes.filter(id => id !== userId);
      else post.likes.push(userId);
      await post.save();
      io.emit('post_updated', post);
  });

  socket.on('comment_post', async ({ postId, author, content, date }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      post.comments.push({ author, content, date });
      await post.save();
      io.emit('post_updated', post);
  });

  socket.on('delete_comment', async ({ postId, commentId }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      post.comments = post.comments.filter(c => c._id.toString() !== commentId);
      await post.save();
      io.emit('post_updated', post);
  });

  // --- TYPING ---
  socket.on('typing_start', (data) => { socket.to(data.roomId).emit('display_typing', data); });
  socket.on('typing_stop', (data) => { socket.to(data.roomId).emit('hide_typing', data); });
});

const port = process.env.PORT || 3000;
http.listen(port, () => { console.log(`Serveur prêt : ${port}`); });
