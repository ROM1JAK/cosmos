const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

// --- 1. CONFIGURATION FICHIERS STATIQUES ---
// Cette ligne est CRUCIALE pour charger style.css et app.js
app.use(express.static(__dirname));

// --- 2. CONNEXION BASE DE DONNÉES ---
const mongoURI = process.env.MONGO_URI; 

if (!mongoURI) {
    console.error("ERREUR CRITIQUE: Il manque la variable MONGO_URI sur Render !");
} else {
    mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
        .then(() => console.log('Connecté à MongoDB !'))
        .catch(err => console.error(err));
}

// --- 3. MODÈLES DE DONNÉES (SCHEMAS) ---

// A. Modèle des Messages
const MessageSchema = new mongoose.Schema({
    content: String,
    type: String, 
    
    // Expéditeur
    senderName: String,
    senderColor: String,
    senderAvatar: String,
    senderRole: String,
    
    // Cible (MP)
    targetName: String, 
    
    // Lieu
    roomId: { type: String, required: true },
    
    // NOUVEAU : Informations de réponse (Citation)
    replyTo: {
        author: String,
        content: String,
        id: String
    },

    // Temps
    date: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// B. Modèle des Personnages (avec Rôle et Propriétaire)
const CharacterSchema = new mongoose.Schema({
    name: String,
    color: String,
    avatar: String,
    role: String,   // Ex: Guerrier, Mage
    ownerId: String // ID unique du joueur qui a créé le perso
});
const Character = mongoose.model('Character', CharacterSchema);

// C. Modèle des Salons (Rooms)
const RoomSchema = new mongoose.Schema({
    name: { type: String, required: true },
    creatorId: String,
    allowedCharacters: [String] // Pour futur usage (salons privés)
});
const Room = mongoose.model('Room', RoomSchema);


// --- 4. ROUTE PRINCIPALE ---
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});


// --- 5. LOGIQUE SOCKET.IO (Temps Réel) ---
io.on('connection', async (socket) => {
  console.log('Un joueur est connecté : ' + socket.id);

  // --- INITIALISATION ---
  
  // A. Envoyer la liste des salons disponibles
  const allRooms = await Room.find();
  socket.emit('rooms_data', allRooms);

  // --- ÉVÉNEMENTS PERSONNAGES ---

  // B. Un joueur demande SES personnages (filtrés par son ID)
  socket.on('request_my_chars', async (playerId) => {
      const myChars = await Character.find({ ownerId: playerId });
      socket.emit('my_chars_data', myChars);
  });

  // C. Création de personnage
  socket.on('create_char', async (charData) => {
    const newChar = new Character(charData);
    await newChar.save();
    // On ne renvoie qu'au créateur
    socket.emit('char_created_success', newChar);
  });
  
  // D. Suppression de personnage
  socket.on('delete_char', async (charName) => {
      await Character.deleteOne({ name: charName });
      socket.emit('char_deleted_success', charName);
  });

  // --- ÉVÉNEMENTS SALONS & CHAT ---

  // E. Rejoindre un salon
  socket.on('join_room', (roomId) => {
      socket.join(roomId);
      // console.log(`Socket ${socket.id} a rejoint ${roomId}`);
  });
  
  // F. Quitter un salon
  socket.on('leave_room', (roomId) => {
      socket.leave(roomId);
  });

  // G. Créer un nouveau salon
  socket.on('create_room', async (roomData) => {
      const newRoom = new Room(roomData);
      await newRoom.save();
      
      // Mettre à jour la liste pour tout le monde
      const updatedRooms = await Room.find();
      io.emit('rooms_data', updatedRooms);
  });

  // H. Demander l'historique des messages d'un salon précis
  socket.on('request_history', async (roomId) => {
      const history = await Message.find({ roomId: roomId })
                                   .sort({ timestamp: 1 })
                                   .limit(200); // Max 200 messages
      socket.emit('history_data', history);
  });

  // I. Réception et renvoi d'un message
  socket.on('message_rp', async (msgData) => {
    // Sécurité : Si pas d'ID de salon, on ignore
    if (!msgData.roomId) return; 

    // 1. Sauvegarde en Base de Données
    const newMessage = new Message(msgData);
    await newMessage.save();

    // 2. Renvoi UNIQUEMENT aux gens connectés dans ce salon
    io.to(msgData.roomId).emit('message_rp', msgData);
  });

});

// --- 6. LANCEMENT DU SERVEUR ---
const port = process.env.PORT || 3000;
http.listen(port, () => {
  console.log(`Serveur lancé sur le port ${port}`);
});

