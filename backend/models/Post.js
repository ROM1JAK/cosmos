const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema({
    content: String, mediaUrl: String, mediaType: String,
    authorCharId: String, authorName: String, authorAvatar: String, authorRole: String, authorColor: String, ownerId: String,
    partyName: String, partyLogo: String,
    repostPostId: { type: String, default: '' },
    quotedPost: {
        _id: String,
        content: String,
        mediaUrl: String,
        mediaType: String,
        authorCharId: String,
        authorName: String,
        authorAvatar: String,
        authorRole: String,
        authorColor: String,
        partyName: String,
        partyLogo: String,
        date: String,
        timestamp: Date,
        isAnonymous: { type: Boolean, default: false },
        isBreakingNews: { type: Boolean, default: false },
        isSponsored: { type: Boolean, default: false },
        linkedCompanyName: { type: String, default: '' }
    },
    likes: [String],
    likeCountDisplay: { type: String, default: '' },
    comments: [{ id: String, authorCharId: String, authorName: String, authorAvatar: String, content: String, mediaUrl: String, mediaType: String, ownerId: String, date: String }],
    date: String, timestamp: { type: Date, default: Date.now },
    isAnonymous: { type: Boolean, default: false },
    isBreakingNews: { type: Boolean, default: false },
    isArticle: { type: Boolean, default: false },
    isLiveNews: { type: Boolean, default: false },
    liveNewsText: { type: String, default: '' },
    isHeadline: { type: Boolean, default: false },
    isSponsored: { type: Boolean, default: false },
    linkedStockId: { type: String, default: '' },
    linkedCompanyName: { type: String, default: '' },
    journalName: { type: String, default: '' },
    journalLogo: { type: String, default: '' },
    urgencyLevel: { type: String, default: null },
    articleTheme: {
        name: { type: String, default: 'edition' },
        label: { type: String, default: 'Édition' },
        paper: { type: String, default: '#f5f0e8' },
        surface: { type: String, default: '#efe4d1' },
        ink: { type: String, default: '#1a1008' },
        muted: { type: String, default: '#6b5c3e' },
        accent: { type: String, default: '#c0973b' }
    },
    poll: { question: String, options: [{ text: String, voters: [String] }] }
});

module.exports = mongoose.model('Post', PostSchema);
