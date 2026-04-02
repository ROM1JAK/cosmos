const mongoose = require('mongoose');

const OmbraMessageSchema = new mongoose.Schema({
    alias: String, content: String, date: String,
    ownerId: { type: String, default: null },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('OmbraMessage', OmbraMessageSchema);
