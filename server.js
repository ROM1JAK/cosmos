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

// NOUVEAU SCHEMA MP
const DirectMessageSchema = new mongoose.Schema({
    senderUsername: String,
    targetUsername: String,
    content: String,
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false }
});
const DirectMessage = mongoose.model('DirectMessage', DirectMessageSchema);

let onlineUsers = {}; // Map: socket.id -> username
let userSockets = {}; // Map: username -> socket.id (Pour envoyer des MP ciblés)

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
                  socket.emit('login_error', "Mot de passe incorrect !");
                  return;
              }
              if(isAdmin && !user.isAdmin) { user.isAdmin = true; await user.save(); }
          } else {
              const existing = await User.findOne({ secretCode: code });
              if(existing) { socket.emit('login_error', "Code déjà utilisé."); return; }
              user = new User({ username, secretCode: code, isAdmin });
              await user.save();
          }

          // Mise à jour maps
          onlineUsers[socket.id] = user.username;
          userSockets[user.username] = socket.id;

          // Compter les MP non lus
          const unreadCount = await DirectMessage.countDocuments({ targetUsername: user.username, read: false });

          socket.emit('login_success', { 
              username: user.username, 
              userId: user.secretCode, 
              isAdmin: user.isAdmin,
              unreadCount: unreadCount
          });
          
          broadcastUserList();

      } catch (e) {
          console.error(e);
          socket.emit('login_error', "Erreur serveur.");
      }
  });

  socket.on('disconnect', () => {
      const user = onlineUsers[socket.id];
      if (user) delete userSockets[user];
      delete onlineUsers[socket.id];
      broadcastUserList();
  });

  // --- ROOMS & RP ---
  socket.on('request_initial_data', async (userId) => {
      socket.emit('rooms_data', await Room.find());
      if(userId) socket.emit('my_chars_data', await Character.find({ ownerId: userId }));
  });

  socket.on('join_room', (roomId) => { socket.join(roomId); });
  socket.on('leave_room', (roomId) => { socket.leave(roomId); });
  
  socket.on('request_history', async (roomId) => {
      const history = await Message.find({ roomId }).sort({ timestamp: 1 }).limit(200);
      socket.emit('history_data', history);
  });

  socket.on('message_rp', async (msgData) => {
      if(!msgData.roomId) return;
      const savedMsg = await new Message(msgData).save();
      io.to(msgData.roomId).emit('message_rp', savedMsg);
  });

  // --- SYSTÈME MESSAGERIE PRIVÉE (NOUVEAU) ---

  // 1. Envoyer un MP
  socket.on('send_dm', async (data) => {
      const { senderUsername, targetUsername, content } = data;
      
      const newDM = new DirectMessage({ senderUsername, targetUsername, content, read: false });
      await newDM.save();

      // Envoyer à l'expéditeur (pour affichage immédiat)
      socket.emit('dm_sent_confirmation', newDM);

      // Envoyer au destinataire s'il est connecté
      const targetSocketId = userSockets[targetUsername];
      if (targetSocketId) {
          io.to(targetSocketId).emit('receive_dm', newDM);
      }
  });

  // 2. Charger la liste des conversations (Inbox)
  socket.on('get_conversations', async (myUsername) => {
      // On cherche tous les messages où je suis impliqué
      const rawMsgs = await DirectMessage.find({ 
          $or: [{ senderUsername: myUsername }, { targetUsername: myUsername }] 
      }).sort({ timestamp: -1 });

      const conversations = {};
      
      rawMsgs.forEach(msg => {
          const otherUser = msg.senderUsername === myUsername ? msg.targetUsername : msg.senderUsername;
          // On ne garde que le dernier message pour l'aperçu
          if (!conversations[otherUser]) {
              conversations[otherUser] = {
                  with: otherUser,
                  lastMessage: msg.content,
                  date: msg.timestamp,
                  unread: 0
              };
          }
          // Compter les non-lus venant de cet utilisateur
          if (msg.targetUsername === myUsername && !msg.read) {
              conversations[otherUser].unread++;
          }
      });

      socket.emit('conversations_list', Object.values(conversations));
  });

  // 3. Charger l'historique d'une conversation spécifique
  socket.on('get_dm_history', async ({ myUsername, otherUsername }) => {
      const history = await DirectMessage.find({
          $or: [
              { senderUsername: myUsername, targetUsername: otherUsername },
              { senderUsername: otherUsername, targetUsername: myUsername }
          ]
      }).sort({ timestamp: 1 }).limit(100);
      
      socket.emit('dm_history_data', history);
  });

  // 4. Marquer comme lu
  socket.on('mark_dm_read', async ({ myUsername, senderUsername }) => {
      await DirectMessage.updateMany(
          { targetUsername: myUsername, senderUsername: senderUsername, read: false },
          { $set: { read: true } }
      );
  });

  // --- FONCTIONS CLASSIQUES (Create Char, Edit, etc...) ---
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
      await Message.updateMany({ senderName: data.originalName, ownerId: data.ownerId }, { $set: { senderName: data.newName, senderRole: data.newRole, senderAvatar: data.newAvatar, senderColor: data.newColor }});
      const myChars = await Character.find({ ownerId: data.ownerId });
      socket.emit('my_chars_data', myChars);
      io.emit('force_history_refresh', { roomId: data.currentRoomId });
  });

  socket.on('delete_char', async (charId) => { await Character.findByIdAndDelete(charId); socket.emit('char_deleted_success', charId); });
  socket.on('create_room', async (roomData) => { await new Room(roomData).save(); io.emit('rooms_data', await Room.find()); });
  socket.on('delete_room', async (roomId) => { await Room.findByIdAndDelete(roomId); await Message.deleteMany({ roomId }); io.emit('rooms_data', await Room.find()); io.emit('force_room_exit', roomId); });
  socket.on('typing_start', (data) => { socket.to(data.roomId).emit('display_typing', data); });
  socket.on('typing_stop', (data) => { socket.to(data.roomId).emit('hide_typing', data); });
});

const port = process.env.PORT || 3000;
http.listen(port, () => { console.log(`Serveur prêt : ${port}`); });
