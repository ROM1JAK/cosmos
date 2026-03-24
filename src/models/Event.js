const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema({
    jour: String, date: String, heure: String, evenement: String,
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Event', EventSchema);
