const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
    targetOwnerId: String, type: String, content: String, fromName: String,
    redirectView: { type: String, default: null },
    redirectData: { type: mongoose.Schema.Types.Mixed, default: null },
    isRead: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', NotificationSchema);
