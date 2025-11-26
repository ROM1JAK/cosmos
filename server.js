const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// On sert le fichier HTML quand on va sur le site
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Quand quelqu'un se connecte
io.on('connection', (socket) => {
  console.log('Un joueur est connecté');

  // Quand le serveur reçoit un message
  socket.on('message_rp', (msg) => {
    // msg contient : { text: "...", nomPerso: "...", couleur: "..." }
    // On renvoie ce message à TOUT LE MONDE (toi et ton ami)
    io.emit('message_rp', msg);
  });
});

// On lance le serveur sur le port 3000
http.listen(3000, () => {
  console.log('Le serveur tourne sur http://localhost:3000');
});