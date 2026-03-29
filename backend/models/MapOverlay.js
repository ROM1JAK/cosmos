const mongoose = require('mongoose');

const mapOverlaySchema = new mongoose.Schema({
	mapKey: {
		type: String,
		required: true,
		enum: ['archipel-pacifique', 'ancienne-archipel', 'archipel-sableuse']
	},
	label: {
		type: String,
		required: true,
		trim: true,
		maxlength: 120
	},
	description: {
		type: String,
		default: '',
		maxlength: 1200
	},
	mode: {
		type: String,
		required: true,
		enum: ['territory', 'danger'],
		default: 'territory'
	},
	targetIds: [{
		type: String,
		trim: true,
		maxlength: 64
	}],
	fillColor: {
		type: String,
		default: '#f59e0b'
	},
	fillOpacity: {
		type: Number,
		default: 0.35,
		min: 0,
		max: 1
	},
	strokeColor: {
		type: String,
		default: '#ef4444'
	},
	strokeWidth: {
		type: Number,
		default: 2,
		min: 0,
		max: 12
	},
	blink: {
		type: Boolean,
		default: false
	},
	createdBy: {
		type: String,
		default: ''
	},
	updatedBy: {
		type: String,
		default: ''
	}
}, { timestamps: true });

mapOverlaySchema.index({ mapKey: 1, updatedAt: -1 });

module.exports = mongoose.model('MapOverlay', mapOverlaySchema);
