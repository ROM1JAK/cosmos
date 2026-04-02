const mongoose = require('mongoose');

const MessageArchiveSchema = new mongoose.Schema({
    originalMessageId: { type: String, required: true, unique: true },
    content: String, type: String,
    senderName: String, senderColor: String, senderAvatar: String, senderRole: String,
    partyName: String, partyLogo: String, ownerId: String, targetName: String, targetOwnerId: String,
    roomId: { type: String, required: true },
    replyTo: { id: String, author: String, content: String },
    edited: { type: Boolean, default: false },
    date: String, timestamp: Date,
    isCharDm: { type: Boolean, default: false },
    senderCharId: String, targetCharId: String,
    archivedAt: { type: Date, default: Date.now }
});

MessageArchiveSchema.index({ timestamp: -1 });
MessageArchiveSchema.index({ roomId: 1, timestamp: -1 });

module.exports = mongoose.model('MessageArchive', MessageArchiveSchema);