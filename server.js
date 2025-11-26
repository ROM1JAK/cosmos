const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

// --- CONNEXION BASE DE DONNÉES ---
const mongoURI = process.env.MONGO_URI; 

if (!mongoURI) {
    console.error("ERREUR CRITIQUE: Il manque la variable MONGO_URI !");
} else {
    mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
        .then(() => console.log('Connecté à MongoDB !'))
        .catch(err => console.error(err));
}

// --- MODÈLES DE DONNÉES (SCHEMAS) ---
// Structure d'un message (Ajout de roomId)
const MessageSchema = new mongoose.Schema({
    content: String, type: String, senderName: String, senderColor: String,
    senderAvatar: String, senderRole: String, targetName: String,
    roomId: { type: String, required: true }, // NOUVEAU : ID du Salon
    date: String, timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// Structure d'un personnage (Identique)
const CharacterSchema = new mongoose.Schema({
    name: String, color: String, avatar: String, role: String, ownerId: String
});
const Character = mongoose.model('Character', CharacterSchema);

// NOUVEAU MODÈLE : Structure d'un Salon
const RoomSchema = new mongoose.Schema({
    name: { type: String, required: true },
    creatorId: { type: String, required: true },
    allowedCharacters: [String] // Array de noms de personnages autorisés
});
const Room = mongoose.model('Room', RoomSchema);

// --- SERVEUR WEB ---
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// --- SOCKET.IO (Temps Réel) ---
io.on('connection', async (socket) => {
  console.log('Joueur connecté');

  // Au démarrage, on envoie tous les messages. On le fait maintenant dans 'request_history'.
  // On envoie la liste des salons
  const allRooms = await Room.find();
  socket.emit('rooms_data', allRooms);

  // 1. Demande des persos privés
  socket.on('request_my_chars', async (playerId) => {
      const myChars = await Character.find({ ownerId: playerId });
      socket.emit('my_chars_data', myChars);
  });
  
  // 2. Demande de l'historique d'un salon
  socket.on('request_history', async (roomId) => {
      // Pour le salon 'global', on utilise le nom 'global'
      const history = await Message.find({ roomId: roomId }).sort({ timestamp: 1 }).limit(200);
      socket.emit('history_data', history);
  });

  // 3. Gestion des Salons (Entrer/Sortir)
  socket.on('join_room', (roomId) => {
      socket.join(roomId);
      console.log(`Socket ${socket.id} a rejoint le salon ${roomId}`);
  });
  
  socket.on('leave_room', (roomId) => {
      socket.leave(roomId);
      console.log(`Socket ${socket.id} a quitté le salon ${roomId}`);
  });
  
  // 4. Création de Salon
  socket.on('create_room', async (roomData) => {
      const newRoom = new Room(roomData);
      await newRoom.save();
      
      // On notifie tout le monde qu'un nouveau salon existe
      const allRooms = await Room.find();
      io.emit('rooms_data', allRooms);
      
      // L'utilisateur doit maintenant rejoindre le salon
      socket.emit('join_room', newRoom._id);
  });


  // 5. Réception d'un message
  socket.on('message_rp', async (msgData) => {
    // ⚠️ On doit s'assurer que le message a bien un ID de salon
    if (!msgData.roomId) return; 

    // On sauvegarde dans la base de données
    const newMessage = new Message(msgData);
    await newMessage.save();

    // On renvoie le message UNIQUEMENT aux sockets qui sont dans ce salon
    io.to(msgData.roomId).emit('message_rp', msgData);
  });

  // 6. Gestion des Personnages (CRUD) - Identique
  socket.on('create_char', async (charData) => {
    const newChar = new Character(charData);
    await newChar.save();
    socket.emit('char_created_success', newChar);
  });
  
  socket.on('delete_char', async (charName) => {
      await Character.deleteOne({ name: charName });
      socket.emit('char_deleted_success', charName);
  });
});

const port = process.env.PORT || 3000;
http.listen(port, () => {
  console.log(`Serveur lancé sur le port ${port}`);
});
