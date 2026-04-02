const mongoose = require('mongoose');

const WikiPageSchema = new mongoose.Schema({
    title:      { type: String, required: true },
    category:   { type: String, default: 'histoire' }, // 'histoire' | 'personnages' | 'lore'
    content:    { type: String, default: '' },
    coverImage: { type: String, default: null },
    authorName: { type: String, default: 'Admin' },
    createdAt:  { type: Date, default: Date.now },
    updatedAt:  { type: Date, default: Date.now }
});

module.exports = mongoose.model('WikiPage', WikiPageSchema);
