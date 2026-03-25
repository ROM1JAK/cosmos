const mongoose = require('mongoose');

const AdminLogSchema = new mongoose.Schema({
    actorUsername: { type: String, default: '' },
    actorUserId: { type: String, default: '' },
    actionType: { type: String, required: true },
    targetType: { type: String, default: '' },
    targetId: { type: String, default: '' },
    targetLabel: { type: String, default: '' },
    message: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    includeInTimeline: { type: Boolean, default: false },
    timelineType: { type: String, default: '' },
    timelineTone: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('AdminLog', AdminLogSchema);