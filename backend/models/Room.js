const mongoose = require('mongoose');

const RoomSchema = new mongoose.Schema({
    name: { type: String, required: true },
    creatorId: String,
    allowedCharacters: [String]
});

module.exports = mongoose.model('Room', RoomSchema);
