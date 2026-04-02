const mongoose = require('mongoose');

const StockSchema = new mongoose.Schema({
    companyName:  String,
    companyLogo:  String,
    charId:       String,
    charName:     String,
    charColor:    String,
    stockColor:   { type: String, default: '#6c63ff' },
    currentValue: { type: Number, default: 1000 },
    trend:        { type: String, default: 'stable' },
    history:      [{ value: Number, date: { type: Date, default: Date.now } }],
    description:  String,
    headquarters: { type: String, default: null },
    updatedAt:    { type: Date, default: Date.now }
});

module.exports = mongoose.model('Stock', StockSchema);
