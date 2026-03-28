const mongoose = require('mongoose');

const CharacterSchema = new mongoose.Schema({
    name: String, color: String, avatar: String, role: String,
    ownerId: String, ownerUsername: String, description: String,
    followers: [String],
    partyName: String, partyLogo: String,
    partyFounder: String, partyCreationDate: String, partyMotto: String, partyDescription: String,
    isOfficial: { type: Boolean, default: false },
    companies: [{ name: String, logo: String, role: String, description: String, headquarters: String, revenue: { type: Number, default: 0 } }],
    capital: { type: Number, default: 0 },
    politicalRole: { type: String, default: '' }
});

module.exports = mongoose.model('Character', CharacterSchema);
