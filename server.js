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
// Note : Les messages n'ont pas besoin de changer
const MessageSchema = new mongoose.Schema({
    content: String,
    type: String, 
    senderName: String,
    senderColor: String,
    senderAvatar: String,
    targetName: String, 
    date: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// NOUVEAU MODÈLE DE PERSONNAGE (avec rôle et propriétaire)
const CharacterSchema = new mongoose.Schema({
    name: String,
    color: String,
    avatar: String,
    role: String, // NOUVEAU : Champ pour le rôle (ex: "Guerrier", "Mage")
    ownerId: String // NOUVEAU : L'ID unique du joueur qui a créé ce personnage
});
const Character = mongoose.model('Character', CharacterSchema);

// --- SERVEUR WEB ---
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// --- SOCKET.IO (Temps Réel) ---
io.on('connection', async (socket) => {
  console.log('Joueur connecté');

  // Au démarrage, on envoie tous les messages. 
  // ATTENTION : On n'envoie plus TOUS les persos, on les filtre plus tard.
  const allMessages = await Message.find().sort({ timestamp: 1 }).limit(200); 
  
  socket.emit('init_data', { messages: allMessages });

  // Réception de l'ID du joueur pour lui envoyer ses persos
  socket.on('request_my_chars', async (playerId) => {
      // On envoie au joueur QUI SE CONNECTE les persos qui lui appartiennent
      const myChars = await Character.find({ ownerId: playerId });
      socket.emit('my_chars_data', myChars);
  });


  // 1. Réception d'un message
  socket.on('message_rp', async (msgData) => {
    const newMessage = new Message(msgData);
    await newMessage.save();
    io.emit('message_rp', msgData);
  });

  // 2. Création d'un nouveau personnage
  socket.on('create_char', async (charData) => {
    const newChar = new Character(charData);
    await newChar.save();
    
    // On ne renvoie rien à tout le monde. On laisse le créateur mettre à jour son propre UI.
    // L'ajout dans la liste de l'ami se fait via la fonction 'request_my_chars' au démarrage.
    socket.emit('char_created_success', charData);
  });
  
  // 3. Suppression d'un personnage
  socket.on('delete_char', async (charName) => {
      await Character.deleteOne({ name: charName });
      // On n'a pas besoin de le notifier aux autres car ils ne le voient pas.
      // On le notifie juste au joueur qui a fait la suppression pour mettre à jour sa liste.
      socket.emit('char_deleted_success', charName);
  });
});

const port = process.env.PORT || 3000;
http.listen(port, () => {
  console.log(`Serveur lancé sur le port ${port}`);
});
