const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

app.use(express.static(__dirname));

// --- CONFIGURATION ADMIN ---
// Change ce code pour sécuriser ton compte admin !
const ADMIN_CODE = "ADMIN"; 

const mongoURI = process.env.MONGO_URI; 
if (!mongoURI) console.error("ERREUR : Variable MONGO_URI manquante.");
else mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true }).then(() => console.log('Connecté à MongoDB.'));

// --- SCHEMAS ---
const UserSchema = new mongoose.Schema({
    username: String,
    secretCode: String, // Sert de mot de passe et d'ID unique
    isAdmin: { type: Boolean, default: false }
});
const User = mongoose.model('User', UserSchema);

const CharacterSchema = new mongoose.Schema({
    name: String, color: String, avatar: String, role: String, 
    ownerId: String, // Le code secret
    ownerUsername: String, // Le pseudo du joueur
    description: String 
});
const Character = mongoose.model('Character', CharacterSchema);

const MessageSchema = new mongoose.Schema({
    content: String, type: String,
    senderName: String, senderColor: String, senderAvatar: String, senderRole: String, 
    ownerId: String, // Code du créateur
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

// --- SOCKET ---
io.on('connection', async (socket) => {
  
  // --- LOGIN / COMPTE ---
  socket.on('login_request', async ({ username, code }) => {
      let user = await User.findOne({ secretCode: code });
      
      // Si c'est le code ADMIN, on donne les droits
      const isAdmin = (code === ADMIN_CODE);

      if (!user) {
          // Création nouveau compte
          user = new User({ username, secretCode: code, isAdmin });
          await user.save();
      } else {
          // Mise à jour du pseudo si changé (optionnel) et admin status
          user.username = username;
          user.isAdmin = isAdmin;
          await user.save();
      }

      // Mettre à jour le nom du joueur sur tous ses persos existants
      await Character.updateMany({ ownerId: code }, { ownerUsername: username });

      socket.emit('login_success', { 
          username: user.username, 
          userId: user.secretCode, // On utilise le code comme ID interne
          isAdmin: user.isAdmin 
      });
  });

  // --- INIT DATA ---
  socket.on('request_initial_data', async (userId) => {
      const allRooms = await Room.find();
      socket.emit('rooms_data', allRooms);
      
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

  socket.on('create_char', async (charData) => {
    const newChar = new Character(charData);
    await newChar.save();
    socket.emit('char_created_success', newChar);
  });
  
  socket.on('edit_char', async (data) => {
      await Character.updateOne(
          { name: data.originalName, ownerId: data.ownerId }, 
          { ...data, ownerUsername: data.ownerUsername } // Update tout
      );
      
      // Update historique messages
      await Message.updateMany(
          { senderName: data.originalName, ownerId: data.ownerId },
          { $set: { senderName: data.newName, senderRole: data.newRole, senderAvatar: data.newAvatar, senderColor: data.newColor }}
      );

      const myChars = await Character.find({ ownerId: data.ownerId });
      socket.emit('my_chars_data', myChars);
      io.emit('force_history_refresh', { roomId: data.currentRoomId });
  });

  socket.on('delete_char', async (charName) => {
      await Character.deleteOne({ name: charName });
      socket.emit('char_deleted_success', charName);
  });

  // --- SALONS & ADMIN ROOMS ---
  socket.on('create_room', async (roomData) => {
      const newRoom = new Room(roomData);
      await newRoom.save();
      io.emit('rooms_data', await Room.find());
  });

  socket.on('delete_room', async (roomId) => {
      // ADMIN ONLY (Vérifié côté client par le code admin, mais on pourrait check ici aussi)
      if (roomId === "global") return; // On ne supprime pas le général
      await Room.findByIdAndDelete(roomId);
      await Message.deleteMany({ roomId: roomId }); // Supprime les messages associés
      io.emit('rooms_data', await Room.find());
      io.emit('force_room_exit', roomId); // Force les gens à sortir
  });

  socket.on('join_room', (roomId) => { socket.join(roomId); });
  socket.on('leave_room', (roomId) => { socket.leave(roomId); });
  
  socket.on('request_history', async (roomId) => {
      const history = await Message.find({ roomId: roomId }).sort({ timestamp: 1 }).limit(200);
      socket.emit('history_data', history);
  });

  // --- MESSAGES & MODÉRATION ---
  socket.on('message_rp', async (msgData) => {
    if (!msgData.roomId) return; 
    const newMessage = new Message(msgData);
    await newMessage.save();
    io.to(msgData.roomId).emit('message_rp', msgData);
  });

  socket.on('delete_message', async (msgId) => {
      await Message.findByIdAndDelete(msgId);
      io.emit('message_deleted', msgId);
  });

  socket.on('edit_message', async (data) => {
      await Message.findByIdAndUpdate(data.id, { content: data.newContent, edited: true });
      io.emit('message_updated', { id: data.id, newContent: data.newContent });
  });

  // COMMANDE CLEAR (ADMIN)
  socket.on('admin_clear_room', async (roomId) => {
      await Message.deleteMany({ roomId: roomId });
      io.to(roomId).emit('history_cleared'); // Signale au client de vider l'écran
  });

  // --- TYPING ---
  socket.on('typing_start', (data) => { socket.to(data.roomId).emit('display_typing', data); });
  socket.on('typing_stop', (data) => { socket.to(data.roomId).emit('hide_typing', data); });
});

const port = process.env.PORT || 3000;
http.listen(port, () => { console.log(`Serveur prêt : ${port}`); });
