const mongoose = require('mongoose');

const DIPLO_STATUS_VALUES = [
    'allie',
    'pacte_defensif',
    'axe_economique',
    'coalition_gouvernementale',
    'coalition_electorale',
    'soutien_strategique',
    'pacte_non_agression',
    'partenariat',
    'neutre',
    'observateur',
    'tension',
    'opposition_parlementaire',
    'rivalite_electorale',
    'rivalite_ideologique',
    'sanction',
    'guerre_commerciale',
    'blocus',
    'hostile',
    'contentieux_territorial',
    'conflit_froid',
    'insurrection_proxy',
    'guerre'
];

const DIPLO_CONTEXT_VALUES = [
    'general',
    'pacte_defensif',
    'axe_economique',
    'coalition_gouvernementale',
    'coalition_electorale',
    'soutien_strategique',
    'mediation',
    'opposition_parlementaire',
    'rivalite_electorale',
    'rivalite_ideologique',
    'guerre_commerciale',
    'contentieux_territorial',
    'insurrection_proxy'
];

const CityRelationSchema = new mongoose.Schema({
    cityA:       { type: mongoose.Schema.Types.ObjectId, ref: 'City', required: true },
    cityB:       { type: mongoose.Schema.Types.ObjectId, ref: 'City', required: true },
    status:      {
        type: String,
        enum: DIPLO_STATUS_VALUES,
        default: 'neutre'
    },
    contextCategory: {
        type: String,
        enum: DIPLO_CONTEXT_VALUES,
        default: 'general'
    },
    allianceGroupKey: { type: String, default: '' },
    description: { type: String, default: '' },
    since:       { type: Date, default: Date.now },
    initiatedBy: { type: String, default: '' }
}, { timestamps: true });

// Unicité bidirectionnelle (A↔B = B↔A)
CityRelationSchema.index({ cityA: 1, cityB: 1 }, { unique: true });

module.exports = mongoose.model('CityRelation', CityRelationSchema);
