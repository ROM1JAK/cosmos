const express = require('express');
const app = express();
const http = require('http').createServer(app);
// ON AUGMENTE LA LIMITE À 5MO POUR ACCEPTER LES IMAGES
const io = require('socket.io')(http, {
    maxHttpBufferSize: 5e6 
});
const mongoose = require('mongoose');

app.use(express.static(__dirname));

const mongoURI = process.env.MONGO_URI; 
if (!mongoURI) console.error("ERREUR : Variable MONGO_URI manquante.");
else mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true }).then(() => console.log('Connecté à MongoDB.'));

// --- SCHEMAS ---
const MessageSchema = new mongoose.Schema({
    content: String, type: String,
    senderName: String, senderColor: String, senderAvatar: String, senderRole: String, ownerId: String,
    targetName: String, roomId: { type: String, required: true },
    replyTo: { id: String, author: String, content: String },
    edited: { type: Boolean, default: false },
    date: String, timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

const CharacterSchema = new mongoose.Schema({
    name: String, color: String, avatar: String, role: String, ownerId: String,
    ownerUsername: String, description: String 
});
const Character = mongoose.model('Character', CharacterSchema);

const RoomSchema = new mongoose.Schema({
    name: { type: String, required: true }, creatorId: String, allowedCharacters: [String]
});
const Room = mongoose.model('Room', RoomSchema);

// --- SOCKET ---
io.on('connection', async (socket) => {
  const allRooms = await Room.find();
  socket.emit('rooms_data', allRooms);

  // --- PERSONNAGES ---
  socket.on('request_my_chars', async (playerId) => {
      const myChars = await Character.find({ ownerId: playerId });
      socket.emit('my_chars_data', myChars);
  });

  socket.on('get_char_profile', async (charId) => {
      // On cherche par ID maintenant, plus sûr
      const char = await Character.findById(charId);
      if(char) socket.emit('char_profile_data', char);
  });

  socket.on('create_char', async (charData) => {
    const newChar = new Character(charData);
    await newChar.save();
    socket.emit('char_created_success', newChar);
  });
  
  // CORRECTION ÉDITION PERSONNAGE
  socket.on('edit_char', async (data) => {
      // 1. Mise à jour du personnage via son ID (_id)
      await Character.findByIdAndUpdate(data.charId, { 
          name: data.newName, 
          role: data.newRole, 
          avatar: data.newAvatar, 
          color: data.newColor,
          description: data.newDescription 
      });

      // 2. Mise à jour des anciens messages (basée sur le nom d'origine)
      await Message.updateMany(
          { senderName: data.originalName, ownerId: data.ownerId },
          { $set: { 
              senderName: data.newName, 
              senderRole: data.newRole, 
              senderAvatar: data.newAvatar, 
              senderColor: data.newColor 
          }}
      );

      // 3. Renvoi des données
      const myChars = await Character.find({ ownerId: data.ownerId });
      socket.emit('my_chars_data', myChars);
      
      // Rafraîchir l'historique pour voir les changements d'avatar/nom
      io.emit('force_history_refresh', { roomId: data.currentRoomId });
  });

  socket.on('delete_char', async (charId) => {
      await Character.findByIdAndDelete(charId);
      socket.emit('char_deleted_success', charId);
  });

  // --- SALONS ---
  socket.on('join_room', (roomId) => { socket.join(roomId); });
  socket.on('leave_room', (roomId) => { socket.leave(roomId); });
  socket.on('create_room', async (roomData) => {
      const newRoom = new Room(roomData);
      await newRoom.save();
      io.emit('rooms_data', await Room.find());
  });
  socket.on('request_history', async (roomId) => {
      const history = await Message.find({ roomId: roomId }).sort({ timestamp: 1 }).limit(200);
      socket.emit('history_data', history);
  });

  // --- MESSAGES ---
  socket.on('message_rp', async (msgData) => {
    if (!msgData.roomId) return; 
    const newMessage = new Message(msgData);
    const savedMsg = await newMessage.save(); // On récupère l'objet sauvegardé avec son ID
    // On envoie l'objet complet (avec _id) à tout le monde
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

  // --- TYPING ---
  socket.on('typing_start', (data) => { socket.to(data.roomId).emit('display_typing', data); });
  socket.on('typing_stop', (data) => { socket.to(data.roomId).emit('hide_typing', data); });
});

const port = process.env.PORT || 3000;
http.listen(port, () => { console.log(`Serveur prêt : ${port}`); });
