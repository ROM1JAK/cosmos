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
    isAdmin: { type: Boolean, default: false },
    avatar: { type: String, default: "" } // Ajout avatar
});
const User = mongoose.model('User', UserSchema);

const CharacterSchema = new mongoose.Schema({
    name: String, color: String, avatar: String, role: String, ownerId: String, ownerUsername: String, description: String 
});
const Character = mongoose.model('Character', CharacterSchema);

// Schema Salon (Public)
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

// Schema MP (Privé - Style Discord)
const DirectMessageSchema = new mongoose.Schema({
    from: String, 
    to: String,   
    content: String,
    read: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
});
const DirectMessage = mongoose.model('DirectMessage', DirectMessageSchema);

// Tracking Sockets
let userSockets = {}; // username -> socket.id
let onlineUsers = {}; // socket.id -> username

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
              if(existing) { socket.emit('login_error', "Code pris."); return; }
              const defaultAvatar = `https://ui-avatars.com/api/?name=${username}&background=random&color=fff`;
              user = new User({ username, secretCode: code, isAdmin, avatar: defaultAvatar });
              await user.save();
          }

          // Enregistrement
          onlineUsers[socket.id] = user.username;
          userSockets[user.username] = socket.id;

          socket.emit('login_success', { 
              username: user.username, 
              userId: user.secretCode, 
              isAdmin: user.isAdmin,
              avatar: user.avatar
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

  // --- SYSTÈME MP (Discord Style) ---
  
  // 1. Liste des conversations (Sidebar Gauche)
  socket.on('request_dm_list', async (myUsername) => {
      // Trouver tous les messages impliquant l'utilisateur
      const messages = await DirectMessage.find({ 
          $or: [{ from: myUsername }, { to: myUsername }] 
      }).sort({ timestamp: -1 });

      const contactsMap = new Map();

      for (const msg of messages) {
          const otherUser = msg.from === myUsername ? msg.to : msg.from;
          if (!contactsMap.has(otherUser)) {
              // Récupérer l'avatar de l'autre user
              const otherUserData = await User.findOne({ username: otherUser });
              const avatar = otherUserData ? otherUserData.avatar : `https://ui-avatars.com/api/?name=${otherUser}`;
              
              // Compter non-lus
              const unread = await DirectMessage.countDocuments({ from: otherUser, to: myUsername, read: false });

              contactsMap.set(otherUser, {
                  username: otherUser,
                  avatar: avatar,
                  unreadCount: unread,
                  lastMsg: msg.content
              });
          }
      }
      socket.emit('dm_list_data', Array.from(contactsMap.values()));
  });

  // 2. Ouvrir Conversation (Charger Historique MP)
  socket.on('join_dm', async ({ myUsername, targetUsername }) => {
      const history = await DirectMessage.find({
          $or: [
              { from: myUsername, to: targetUsername },
              { from: targetUsername, to: myUsername }
          ]
      }).sort({ timestamp: 1 }).limit(100);

      // Marquer comme lu
      await DirectMessage.updateMany({ from: targetUsername, to: myUsername, read: false }, { $set: { read: true } });

      socket.emit('dm_history_data', { target: targetUsername, history });
  });

  // 3. Envoyer MP
  socket.on('send_dm', async ({ from, to, content }) => {
      const dm = new DirectMessage({ from, to, content, read: false });
      await dm.save();

      // Formater pour le client
      const msgPayload = {
          from, to, content, timestamp: dm.timestamp,
          avatar: `https://ui-avatars.com/api/?name=${from}` // On pourrait optimiser en cherchant l'avatar user
      };

      // Envoyer à l'expéditeur (pour affichage immédiat)
      socket.emit('receive_dm', msgPayload);

      // Envoyer au destinataire
      const targetSocket = userSockets[to];
      if (targetSocket) {
          io.to(targetSocket).emit('receive_dm', msgPayload);
          io.to(targetSocket).emit('refresh_dm_list'); // Pour mettre à jour la sidebar (badge, ordre)
      }
  });


  // --- SALONS & RP ---
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

  // --- FONCTIONS CLASSIQUES ---
  socket.on('create_char', async (data) => {
      const user = await User.findOne({ secretCode: data.ownerId });
      if (user) data.ownerUsername = user.username;
      await new Character(data).save();
      socket.emit('char_created_success', await Character.findOne(data));
  });
  socket.on('edit_char', async (data) => {
      await Character.findByIdAndUpdate(data.charId, { name: data.newName, role: data.newRole, avatar: data.newAvatar, color: data.newColor, description: data.newDescription });
      await Message.updateMany({ senderName: data.originalName, ownerId: data.ownerId }, { $set: { senderName: data.newName, senderRole: data.newRole, senderAvatar: data.newAvatar, senderColor: data.newColor }});
      socket.emit('my_chars_data', await Character.find({ ownerId: data.ownerId }));
      io.emit('force_history_refresh', { roomId: data.currentRoomId });
  });
  socket.on('delete_char', async (charId) => { await Character.findByIdAndDelete(charId); socket.emit('char_deleted_success', charId); });
  socket.on('create_room', async (roomData) => { await new Room(roomData).save(); io.emit('rooms_data', await Room.find()); });
  socket.on('delete_room', async (roomId) => { await Room.findByIdAndDelete(roomId); await Message.deleteMany({ roomId }); io.emit('rooms_data', await Room.find()); io.emit('force_room_exit', roomId); });
  
  // Typing
  socket.on('typing_start', (data) => { socket.to(data.roomId).emit('display_typing', data); });
  socket.on('typing_stop', (data) => { socket.to(data.roomId).emit('hide_typing', data); });
});

const port = process.env.PORT || 3000;
http.listen(port, () => { console.log(`Serveur prêt : ${port}`); });
