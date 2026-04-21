const mongoose = require('mongoose');

const DIPLO_STATUS_VALUES = [
    'allie',
    'pacte_non_agression',
    'partenariat',
    'neutre',
    'observateur',
    'tension',
    'sanction',
    'blocus',
    'hostile',
    'conflit_froid',
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

const PartySnapshotSchema = new mongoose.Schema({
    key: { type: String, required: true },
    name: { type: String, required: true },
    logo: { type: String, default: '' }
}, { _id: false });

const PartyRelationSchema = new mongoose.Schema({
    partyA: { type: PartySnapshotSchema, required: true },
    partyB: { type: PartySnapshotSchema, required: true },
    status: {
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
    since: { type: Date, default: Date.now },
    initiatedBy: { type: String, default: '' }
}, { timestamps: true });

PartyRelationSchema.index({ 'partyA.key': 1, 'partyB.key': 1 }, { unique: true });

module.exports = mongoose.model('PartyRelation', PartyRelationSchema);