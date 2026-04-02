const mongoose = require('mongoose');

const CityRelationSchema = new mongoose.Schema({
    cityA:       { type: mongoose.Schema.Types.ObjectId, ref: 'City', required: true },
    cityB:       { type: mongoose.Schema.Types.ObjectId, ref: 'City', required: true },
    status:      {
        type: String,
        enum: [
            'allie',                // Alliance militaire & économique
            'pacte_non_agression',  // Pacte de Non-Agression
            'partenariat',          // Partenariat économique
            'neutre',               // Neutre
            'observateur',          // Sous surveillance
            'tension',              // Tensions diplomatiques
            'sanction',             // Sanctions économiques
            'blocus',               // Blocus
            'hostile',              // Relations hostiles
            'conflit_froid',        // Conflit froid (proxy)
            'guerre'                // En guerre ouverte
        ],
        default: 'neutre'
    },
    description: { type: String, default: '' },
    since:       { type: Date, default: Date.now },
    initiatedBy: { type: String, default: '' }
}, { timestamps: true });

// Unicité bidirectionnelle (A↔B = B↔A)
CityRelationSchema.index({ cityA: 1, cityB: 1 }, { unique: true });

module.exports = mongoose.model('CityRelation', CityRelationSchema);
