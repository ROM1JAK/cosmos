const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { maxHttpBufferSize: 10e6 }); // Augmenté pour vidéos
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
    followers: [String] // Liste des UserID (secretCode) qui suivent ce perso
});
const Character = mongoose.model('Character', CharacterSchema);

const NotificationSchema = new mongoose.Schema({
    recipientId: String, // OwnerId du destinataire
    type: String, // 'like', 'comment', 'follow'
    content: String,
    triggerName: String, // Qui a déclenché (Nom perso ou User)
    read: { type: Boolean, default: false },
    date: String,
    timestamp: { type: Date, default: Date.now }
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
    content: String,
    mediaUrl: String,
    mediaType: String, // image, video, audio
    authorName: String, authorAvatar: String, authorRole: String, authorColor: String, ownerId: String,
    likes: [String],
    comments: [{
        id: String, authorName: String, authorAvatar: String, content: String, 
        ownerId: String, date: String, mediaUrl: String, mediaType: String
    }],
    date: String,
    timestamp: { type: Date, default: Date.now }
});
const Post = mongoose.model('Post', PostSchema);

let onlineUsers = {}; 

function broadcastUserList() {
    const uniqueNames = [...new Set(Object.values(onlineUsers))];
    io.emit('update_user_list', uniqueNames);
}

// Fonction utilitaire Notif
async function createNotification(recipientId, type, content, triggerName) {
    if(!recipientId || recipientId === "null") return;
    const notif = new Notification({
        recipientId, type, content, triggerName,
        date: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
    });
    await notif.save();
    // Chercher les sockets du recipient
    const recipientSockets = Object.keys(onlineUsers).filter(id => {
        // Attention: onlineUsers map socketId -> username. 
        // Pour être précis il faudrait mapper socketId -> userId. 
        // Ici on va émettre à tous, le client filtrera, ou on optimise plus tard.
        // Simplification: On emet un event global 'check_notifications' qui dit au client de refresh
        return true; 
    });
    io.emit('notification_trigger', { recipientId });
}

io.on('connection', async (socket) => {
  
  // --- LOGIN ---
  socket.on('login_request', async ({ username, code }) => {
      try {
          let user = await User.findOne({ username: username });
          const isAdmin = (code === ADMIN_CODE);

          if (user) {
              if (user.secretCode !== code && !isAdmin) {
                  socket.emit('login_error', "Mot de passe incorrect !");
                  return;
              }
              if(isAdmin && !user.isAdmin) { user.isAdmin = true; await user.save(); }
          } else {
              const existingCode = await User.findOne({ secretCode: code });
              if(existingCode) {
                   socket.emit('login_error', "Code déjà utilisé par " + existingCode.username);
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

  socket.on('disconnect', () => {
      delete onlineUsers[socket.id];
      broadcastUserList();
  });

  socket.on('request_initial_data', async (userId) => {
      socket.emit('rooms_data', await Room.find());
      const posts = await Post.find().sort({ timestamp: -1 }).limit(50);
      socket.emit('feed_data', posts);
      
      if(userId) {
          const myChars = await Character.find({ ownerId: userId });
          socket.emit('my_chars_data', myChars);
          
          // Notifs
          const notifs = await Notification.find({ recipientId: userId }).sort({ timestamp: -1 }).limit(20);
          socket.emit('notifications_data', notifs);
      }
  });

  // --- PERSONNAGES & SOCIAL ---
  socket.on('get_char_profile', async (charName) => {
      const char = await Character.findOne({ name: charName }).sort({_id: -1});
      if(char) socket.emit('char_profile_data', char);
  });

  socket.on('create_char', async (data) => {
    const count = await Character.countDocuments({ ownerId: data.ownerId });
    if (count >= 20) return; 
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
      // Update refs (simplifié)
      await Message.updateMany({ senderName: data.originalName, ownerId: data.ownerId }, { $set: { senderName: data.newName, senderRole: data.newRole, senderAvatar: data.newAvatar, senderColor: data.newColor }});
      await Post.updateMany({ authorName: data.originalName, ownerId: data.ownerId }, { $set: { authorName: data.newName, authorRole: data.newRole, authorAvatar: data.newAvatar, authorColor: data.newColor }});
      
      const myChars = await Character.find({ ownerId: data.ownerId });
      socket.emit('my_chars_data', myChars);
      io.emit('force_history_refresh', { roomId: data.currentRoomId });
      io.emit('reload_posts'); 
  });

  socket.on('delete_char', async (charId) => {
      await Character.findByIdAndDelete(charId);
      socket.emit('char_deleted_success', charId);
  });

  socket.on('follow_char', async ({ charId, userId }) => {
      const char = await Character.findById(charId);
      if(!char) return;
      
      const index = char.followers.indexOf(userId);
      if(index === -1) {
          char.followers.push(userId);
          // Notif
          const userFollower = await User.findOne({ secretCode: userId });
          if(userFollower && char.ownerId !== userId) {
              await createNotification(char.ownerId, 'follow', `suit votre personnage ${char.name}`, userFollower.username);
          }
      } else {
          char.followers.splice(index, 1);
      }
      await char.save();
      socket.emit('char_profile_updated', char);
  });

  // --- NOTIFICATIONS ---
  socket.on('mark_notifications_read', async (userId) => {
      await Notification.updateMany({ recipientId: userId, read: false }, { read: true });
      // Renvoi la liste à jour
      const notifs = await Notification.find({ recipientId: userId }).sort({ timestamp: -1 }).limit(20);
      socket.emit('notifications_data', notifs);
  });

  // --- ROOMS ---
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
  
  // --- HISTORIQUE & MESSAGES ---
  socket.on('request_history', async (data) => {
      const roomId = (typeof data === 'object') ? data.roomId : data;
      const history = await Message.find({ roomId: roomId, targetName: { $exists: false } }).sort({ timestamp: 1 }).limit(200);
      socket.emit('history_data', history);
  });

  socket.on('request_dm_history', async ({ myUsername, targetUsername }) => {
      const messages = await Message.find({
           roomId: 'dm',
           $or: [
               { senderName: myUsername, targetName: targetUsername },
               { senderName: targetUsername, targetName: myUsername }
           ]
      }).sort({ timestamp: 1 });
      socket.emit('dm_history_data', { target: targetUsername, history: messages });
  });

  socket.on('message_rp', async (msgData) => {
    if (!msgData.roomId) return; 
    if (msgData.senderName === "Narrateur") {
        const user = await User.findOne({ secretCode: msgData.ownerId });
        if (!user || !user.isAdmin) return;
    }

    const newMessage = new Message(msgData);
    const savedMsg = await newMessage.save();
    io.to(msgData.roomId).emit('message_rp', savedMsg); 
  });

  socket.on('delete_message', async (msgId) => {
      await Message.findByIdAndDelete(msgId);
      io.emit('message_deleted', msgId);
  });
  
  // --- POSTS (FEED) ---
  socket.on('create_post', async (postData) => {
      const newPost = new Post(postData);
      const savedPost = await newPost.save();
      
      // Notif aux followers du personnage auteur
      if(savedPost.authorName) {
         const char = await Character.findOne({ name: savedPost.authorName, ownerId: postData.ownerId });
         if(char && char.followers && char.followers.length > 0) {
             for(const followerId of char.followers) {
                 if(followerId !== postData.ownerId) {
                     await createNotification(followerId, 'post', `a posté du nouveau contenu.`, savedPost.authorName);
                 }
             }
         }
      }
      io.emit('new_post', savedPost);
  });

  socket.on('delete_post', async (postId) => {
      await Post.findByIdAndDelete(postId);
      io.emit('post_deleted', postId);
  });

  socket.on('like_post', async ({ postId, userId }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      
      const userLiker = await User.findOne({ secretCode: userId });
      const likerName = userLiker ? userLiker.username : "Inconnu";

      const index = post.likes.indexOf(userId);
      if(index === -1) {
          post.likes.push(userId);
          if(post.ownerId !== userId) {
              await createNotification(post.ownerId, 'like', `a aimé votre post.`, likerName);
          }
      } else {
          post.likes.splice(index, 1);
      }
      
      await post.save();
      io.emit('post_updated', post);
  });

  socket.on('post_comment', async ({ postId, comment }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      comment.id = new mongoose.Types.ObjectId().toString();
      post.comments.push(comment);
      
      if(post.ownerId !== comment.ownerId) {
          await createNotification(post.ownerId, 'comment', `a commenté votre post.`, comment.authorName);
      }

      await post.save();
      io.emit('post_updated', post);
  });

  socket.on('delete_comment', async ({ postId, commentId }) => {
      const post = await Post.findById(postId);
      if(!post) return;
      post.comments = post.comments.filter(c => c.id !== commentId);
      await post.save();
      io.emit('post_updated', post);
  });

  // --- TYPING ---
  socket.on('typing_start', (data) => { socket.to(data.roomId).emit('display_typing', data); });
  socket.on('typing_stop', (data) => { socket.to(data.roomId).emit('hide_typing', data); });
});

const port = process.env.PORT || 3000;
http.listen(port, () => { console.log(`Serveur prêt : ${port}`); });
