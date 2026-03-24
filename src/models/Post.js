const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema({
    content: String, mediaUrl: String, mediaType: String,
    authorCharId: String, authorName: String, authorAvatar: String, authorRole: String, authorColor: String, ownerId: String,
    partyName: String, partyLogo: String,
    likes: [String],
    comments: [{ id: String, authorCharId: String, authorName: String, authorAvatar: String, content: String, mediaUrl: String, mediaType: String, ownerId: String, date: String }],
    date: String, timestamp: { type: Date, default: Date.now },
    isAnonymous: { type: Boolean, default: false },
    isBreakingNews: { type: Boolean, default: false },
    isArticle: { type: Boolean, default: false },
    isHeadline: { type: Boolean, default: false },
    urgencyLevel: { type: String, default: null },
    poll: { question: String, options: [{ text: String, voters: [String] }] }
});

module.exports = mongoose.model('Post', PostSchema);
