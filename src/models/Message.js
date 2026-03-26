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

MessageSchema.index({ roomId: 1, timestamp: -1 });
MessageSchema.index({ isCharDm: 1, roomId: 1, timestamp: -1 });
MessageSchema.index({ roomId: 1, senderName: 1, targetName: 1, timestamp: -1 });
MessageSchema.index({ isCharDm: 1, senderCharId: 1, timestamp: -1 });
MessageSchema.index({ isCharDm: 1, targetCharId: 1, timestamp: -1 });

module.exports = mongoose.model('Message', MessageSchema);
