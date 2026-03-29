const mongoose = require('mongoose');

const mapMarkerSchema = new mongoose.Schema({
	mapKey: {
		type: String,
		required: true,
		enum: ['archipel-pacifique', 'ancienne-archipel']
	},
	title: {
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
	x: {
		type: Number,
		required: true,
		min: 0,
		max: 100
	},
	y: {
		type: Number,
		required: true,
		min: 0,
		max: 100
	},
	imageUrl: {
		type: String,
		default: ''
	},
	cityId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: 'City',
		default: null
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

mapMarkerSchema.index({ mapKey: 1, updatedAt: -1 });

module.exports = mongoose.model('MapMarker', mapMarkerSchema);