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

const EntitySnapshotSchema = new mongoose.Schema({
    scope: { type: String, enum: ['city', 'party'], required: true },
    key: { type: String, required: true },
    id: { type: String, required: true },
    name: { type: String, required: true },
    logo: { type: String, default: '' }
}, { _id: false });

const MixedRelationSchema = new mongoose.Schema({
    sourceAllianceScope: { type: String, enum: ['city', 'party'], required: true },
    sourceAllianceGroupKey: { type: String, required: true },
    sourceAllianceGroupName: { type: String, default: '' },
    sourceEntities: { type: [EntitySnapshotSchema], default: [] },
    targetEntity: { type: EntitySnapshotSchema, required: true },
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
    description: { type: String, default: '' },
    since: { type: Date, default: Date.now },
    initiatedBy: { type: String, default: '' }
}, { timestamps: true });

MixedRelationSchema.index({ sourceAllianceGroupKey: 1, 'targetEntity.scope': 1, 'targetEntity.key': 1 }, { unique: true });

module.exports = mongoose.model('MixedRelation', MixedRelationSchema);