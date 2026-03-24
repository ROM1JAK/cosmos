const mongoose = require('mongoose');

const WikiPageSchema = new mongoose.Schema({
    title:     { type: String, required: true },
    category:  { type: String, required: true },
    content:   String,
    createdBy: String,
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WikiPage', WikiPageSchema);
