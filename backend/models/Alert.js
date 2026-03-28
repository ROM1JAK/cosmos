const mongoose = require('mongoose');

const AlertSchema = new mongoose.Schema({
    message: String,
    color: { type: String, default: 'red' },
    active: { type: Boolean, default: true },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Alert', AlertSchema);
