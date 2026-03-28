const mongoose = require('mongoose');

const CitySchema = new mongoose.Schema({
    name:       { type: String, required: true, unique: true },
    archipel:   { type: String, default: 'Archipel Pacifique' },
    president:  { type: String, default: 'Vacant' },
    capitale:   { type: String, default: null },
    population: { type: Number, default: 500000 },
    baseEDC:    { type: Number, default: 1000000000000 },
    trend:      { type: String, default: 'stable' },
    flag:       { type: String, default: null },
    historyEDC: [{ value: Number, date: { type: Date, default: Date.now } }],
    updatedAt:  { type: Date, default: Date.now }
});

module.exports = mongoose.model('City', CitySchema);
