const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { maxHttpBufferSize: 5e6 });
const mongoose = require('mongoose');

app.use(express.static(__dirname));

const ADMIN_CODE = "ADMIN"; // Change ce code !
const mongoURI = process.env.MONGO_URI; 

if (!mongoURI) console.error("ERREUR : Variable MONGO_URI manquante.");
else mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true }).then(() => console.log('Connecté à MongoDB.'));

// --- SCHEMAS ---
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true }, // Pseudo UNIQUE
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
    targetName: String, roomId: { type: String, required: true },
    replyTo: { id: String, author: String, content: String },
    edited: { type: Boolean, default: false },
    date: String, timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

const RoomSchema = new mongoose.Schema({
    name: { type: String, required: true }, creatorId: String, allowedCharacters: [String]
});
const Room = mongoose.model('Room', RoomSchema);

// --- GESTION UTILISATEURS EN LIGNE ---
let onlineUsers = {}; 

function broadcastUserList() {
    const uniqueNames = [...new Set(Object.values(onlineUsers))];
    io.emit('update_user_list', uniqueNames);
}

// --- SOCKET ---
io.on('connection', async (socket) => {
  
  // --- LOGIN STRICT ---
  socket.on('login_request', async ({ username, code }) => {
      try {
          // 1. On cherche si le PSEUDO existe déjà
          let user = await User.findOne({ username: username });
          const isAdmin = (code === ADMIN_CODE);

          if (user) {
              // LE COMPTE EXISTE : VÉRIFICATION DU CODE
              if (user.secretCode !== code && !isAdmin) { // L'admin peut bypasser (optionnel)
                  socket.emit('login_error', "Mot de passe incorrect pour ce pseudo !");
                  return;
              }
              // Si c'est le bon code, on met à jour le statut admin au cas où
              if(isAdmin && !user.isAdmin) { user.isAdmin = true; await user.save(); }
          } else {
              // LE COMPTE N'EXISTE PAS : CRÉATION
              user = new User({ username, secretCode: code, isAdmin });
              await user.save();
          }

          // Succès
          onlineUsers[socket.id] = user.username;
          broadcastUserList();

          // On renvoie le secretCode (qui sert d'ID utilisateur interne)
          socket.emit('login_success', { 
              username: user.username, 
              userId: user.secretCode, 
              isAdmin: user.isAdmin 
          });

      } catch (e) {
          console.error(e);
          socket.emit('login_error', "Erreur serveur lors de la connexion.");
      }
  });

  socket.on('disconnect', () => {
      delete onlineUsers[socket.id];
      broadcastUserList();
  });

  // --- INIT DATA ---
  socket.on('request_initial_data', async (userId) => {
      socket.emit('rooms_data', await Room.find());
      if(userId) {
          // Récupération des persos liés au code secret (ownerId)
          const myChars = await Character.find({ ownerId: userId });
          socket.emit('my_chars_data', myChars);
      }
  });

  // --- PERSONNAGES ---
  socket.on('get_char_profile', async (charId) => {
      let char;
      if(mongoose.Types.ObjectId.isValid(charId)) char = await Character.findById(charId);
      else char = await Character.findOne({ name: charId }).sort({_id: -1});
      if(char) socket.emit('char_profile_data', char);
  });

  socket.on('create_char', async (data) => {
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
      socket.emit('my_chars_data', await Character.find({ ownerId: data.ownerId }));
      io.emit('force_history_refresh', { roomId: data.currentRoomId });
  });

  socket.on('delete_char', async (charId) => {
      await Character.findByIdAndDelete(charId);
      socket.emit('char_deleted_success', charId);
  });

  // --- SALONS ---
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
  socket.on('request_history', async (roomId) => {
      const history = await Message.find({ roomId: roomId }).sort({ timestamp: 1 }).limit(200);
      socket.emit('history_data', history);
  });

  // --- MESSAGES ---
  socket.on('message_rp', async (msgData) => {
    if (!msgData.roomId) return; 
    // Sécurité Narrateur
    if (msgData.senderName === "Narrateur") {
        // On vérifie si l'user est admin via son code
        const user = await User.findOne({ secretCode: msgData.ownerId });
        if (!user || !user.isAdmin) return; // Bloqué
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

  // --- TYPING ---
  socket.on('typing_start', (data) => { socket.to(data.roomId).emit('display_typing', data); });
  socket.on('typing_stop', (data) => { socket.to(data.roomId).emit('hide_typing', data); });
});

const port = process.env.PORT || 3000;
http.listen(port, () => { console.log(`Serveur prêt : ${port}`); });
