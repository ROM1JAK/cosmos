const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

app.use(express.static(__dirname));

const mongoURI = process.env.MONGO_URI; 
if (!mongoURI) {
    console.error("ERREUR : Variable MONGO_URI manquante.");
} else {
    mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
        .then(() => console.log('Connecté à MongoDB.'))
        .catch(err => console.error(err));
}

// --- SCHEMAS ---
const MessageSchema = new mongoose.Schema({
    content: String, type: String,
    senderName: String, senderColor: String, senderAvatar: String, senderRole: String, ownerId: String, // Ajout ownerId pour sécurité edit
    targetName: String, roomId: { type: String, required: true },
    replyTo: { id: String, author: String, content: String },
    edited: { type: Boolean, default: false }, // Pour afficher "(modifié)"
    date: String, timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

const CharacterSchema = new mongoose.Schema({
    name: String, color: String, avatar: String, role: String, ownerId: String
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

  socket.on('create_char', async (charData) => {
    const newChar = new Character(charData);
    await newChar.save();
    socket.emit('char_created_success', newChar);
  });
  
  // MODIFIER PERSONNAGE
  socket.on('edit_char', async (data) => {
      // data contient { originalName, newName, newRole, newAvatar, newColor }
      await Character.updateOne({ name: data.originalName, ownerId: data.ownerId }, {
          name: data.newName, role: data.newRole, avatar: data.newAvatar, color: data.newColor
      });
      // On renvoie la liste mise à jour au joueur
      const myChars = await Character.find({ ownerId: data.ownerId });
      socket.emit('my_chars_data', myChars);
  });

  socket.on('delete_char', async (charName) => {
      await Character.deleteOne({ name: charName });
      socket.emit('char_deleted_success', charName);
  });

  // --- SALONS ---
  socket.on('join_room', (roomId) => { socket.join(roomId); });
  socket.on('leave_room', (roomId) => { socket.leave(roomId); });
  socket.on('create_room', async (roomData) => {
      const newRoom = new Room(roomData);
      await newRoom.save();
      const updatedRooms = await Room.find();
      io.emit('rooms_data', updatedRooms);
  });
  socket.on('request_history', async (roomId) => {
      const history = await Message.find({ roomId: roomId }).sort({ timestamp: 1 }).limit(200);
      socket.emit('history_data', history);
  });

  // --- MESSAGES (CRUD) ---
  socket.on('message_rp', async (msgData) => {
    if (!msgData.roomId) return; 
    const newMessage = new Message(msgData);
    await newMessage.save();
    io.to(msgData.roomId).emit('message_rp', msgData); // Renvoie l'objet complet (avec _id)
  });

  // SUPPRIMER MESSAGE
  socket.on('delete_message', async (msgId) => {
      await Message.findByIdAndDelete(msgId);
      io.emit('message_deleted', msgId); // On broadcast à tout le monde
  });

  // MODIFIER MESSAGE
  socket.on('edit_message', async (data) => {
      await Message.findByIdAndUpdate(data.id, { content: data.newContent, edited: true });
      io.emit('message_updated', { id: data.id, newContent: data.newContent });
  });

  // --- INDICATEUR D'ÉCRITURE ---
  socket.on('typing_start', (data) => {
      // data = { roomId, charName }
      socket.to(data.roomId).emit('display_typing', data);
  });
  
  socket.on('typing_stop', (data) => {
      socket.to(data.roomId).emit('hide_typing', data);
  });

});

const port = process.env.PORT || 3000;
http.listen(port, () => { console.log(`Serveur prêt : ${port}`); });
