const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    content: String, type: String,
    senderName: String, senderColor: String, senderAvatar: String, senderRole: String,
    partyName: String, partyLogo: String, ownerId: String, targetName: String, targetOwnerId: String,
    roomId: { type: String, required: true },
    replyTo: { id: String, author: String, content: String },
    edited: { type: Boolean, default: false },
    date: String, timestamp: { type: Date, default: Date.now },
    isCharDm: { type: Boolean, default: false },
    senderCharId: String, targetCharId: String
});

module.exports = mongoose.model('Message', MessageSchema);
