const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    secretCode: String,
    isAdmin: { type: Boolean, default: false },
    uiTheme: { type: String, default: 'default' },
    ombraAlias: { type: String, default: null }
});

module.exports = mongoose.model('User', UserSchema);
