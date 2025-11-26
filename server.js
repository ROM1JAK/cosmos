const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');

// --- CONNEXION BASE DE DONNÉES ---
// On récupère le lien secret depuis Render (voir Phase 3)
const mongoURI = process.env.MONGO_URI; 

if (!mongoURI) {
    console.error("ERREUR CRITIQUE: Il manque la variable MONGO_URI sur Render !");
} else {
    mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
        .then(() => console.log('Connecté à MongoDB !'))
        .catch(err => console.error(err));
}

// --- MODÈLES DE DONNÉES (SCHEMAS) ---
// 1. Structure d'un message
const MessageSchema = new mongoose.Schema({
    content: String,
    type: String, // 'text' ou 'image'
    senderName: String,
    senderColor: String,
    senderAvatar: String,
    targetName: String, // Pour les MP
    date: String,
    timestamp: { type: Date, default: Date.now } // Pour trier
});
const Message = mongoose.model('Message', MessageSchema);

// 2. Structure d'un personnage (Partagé)
const CharacterSchema = new mongoose.Schema({
    name: String,
    color: String,
    avatar: String
});
const Character = mongoose.model('Character', CharacterSchema);

// --- SERVEUR WEB ---
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// --- SOCKET.IO (Temps Réel) ---
io.on('connection', async (socket) => {
  console.log('Joueur connecté');

  // 1. Quand quelqu'un arrive, on lui envoie TOUT l'historique et les Persos
  const allMessages = await Message.find().sort({ timestamp: 1 }).limit(200); // Les 200 derniers
  const allChars = await Character.find();
  
  socket.emit('init_data', { messages: allMessages, characters: allChars });

  // 2. Réception d'un message
  socket.on('message_rp', async (msgData) => {
    // On sauvegarde dans la base de données
    const newMessage = new Message(msgData);
    await newMessage.save();

    // On renvoie à tout le monde
    io.emit('message_rp', msgData);
  });

  // 3. Création d'un nouveau personnage
  socket.on('create_char', async (charData) => {
    const newChar = new Character(charData);
    await newChar.save();
    
    // On dit à tout le monde d'ajouter ce perso à leur liste
    io.emit('new_char_created', charData);
  });
  
  // 4. Suppression d'un personnage
  socket.on('delete_char', async (charName) => {
      await Character.deleteOne({ name: charName });
      io.emit('char_deleted', charName);
  });
});

const port = process.env.PORT || 3000;
http.listen(port, () => {
  console.log(`Serveur lancé sur le port ${port}`);
});
