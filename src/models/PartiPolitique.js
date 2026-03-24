const mongoose = require('mongoose');

const PartiPolitiqueSchema = new mongoose.Schema({
    nom:         { type: String, required: true },
    logo:        String,
    slogan:      String,
    couleur:     { type: String, default: '#6c63ff' },
    dateCreation: String,
    fondateur:   String,
    dirigeant:   String,
    ideologie:   String,
    cite:        String,
    siege:       String,
    membres:     { type: Number, default: 0 },
    assemblee:   { type: Number, default: 0 },
    description: String,
    timestamp:   { type: Date, default: Date.now }
});

module.exports = mongoose.model('PartiPolitique', PartiPolitiqueSchema);
