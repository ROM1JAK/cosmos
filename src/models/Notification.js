const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    targetOwnerId: String, type: String, content: String, fromName: String,
    isRead: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', NotificationSchema);
