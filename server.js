const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

// Fichiers statiques (CSS/JS)
app.use(express.static(__dirname));

// Connexion MongoDB
const mongoURI = process.env.MONGO_URI; 
if (!mongoURI) {
    console.error("ERREUR : Variable MONGO_URI manquante sur Render.");
} else {
    mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
        .then(() => console.log('Connecté à MongoDB.'))
        .catch(err => console.error(err));
}

// --- SCHEMAS ---

// Messages
const MessageSchema = new mongoose.Schema({
    content: String,
    type: String,
    
    // Expéditeur
    senderName: String,
    senderColor: String,
    senderAvatar: String,
    senderRole: String,
    
    // Cible & Lieu
    targetName: String,
    roomId: { type: String, required: true },
    
    // Réponse (Context)
    replyTo: {
        id: String,
        author: String,
        content: String
    },

    date: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// Personnages
const CharacterSchema = new mongoose.Schema({
    name: String, color: String, avatar: String, role: String, ownerId: String
});
const Character = mongoose.model('Character', CharacterSchema);

// Salons
const RoomSchema = new mongoose.Schema({
    name: { type: String, required: true }, creatorId: String, allowedCharacters: [String]
});
const Room = mongoose.model('Room', RoomSchema);


// --- SOCKET.IO ---

io.on('connection', async (socket) => {
  // Init
  const allRooms = await Room.find();
  socket.emit('rooms_data', allRooms);

  // Gestion Persos
  socket.on('request_my_chars', async (playerId) => {
      const myChars = await Character.find({ ownerId: playerId });
      socket.emit('my_chars_data', myChars);
  });

  socket.on('create_char', async (charData) => {
    const newChar = new Character(charData);
    await newChar.save();
    socket.emit('char_created_success', newChar);
  });
  
  socket.on('delete_char', async (charName) => {
      await Character.deleteOne({ name: charName });
      socket.emit('char_deleted_success', charName);
  });

  // Gestion Salles
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

  // Gestion Messages
  socket.on('message_rp', async (msgData) => {
    if (!msgData.roomId) return; 
    const newMessage = new Message(msgData);
    await newMessage.save();
    io.to(msgData.roomId).emit('message_rp', msgData);
  });
});

const port = process.env.PORT || 3000;
http.listen(port, () => { console.log(`Serveur prêt sur le port ${port}`); });
