import mongoose from 'mongoose';

const systemLogSchema = new mongoose.Schema({
  action: { type: String, required: true },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event'
  },
  legacyId: String,
  student: mongoose.Schema.Types.Mixed,
  event: mongoose.Schema.Types.Mixed,
  eventName: String,
  studentName: String,
  dateTime: mongoose.Schema.Types.Mixed,
  timestamp: mongoose.Schema.Types.Mixed,
  status: mongoose.Schema.Types.Mixed,
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true, strict: false });

systemLogSchema.virtual('id').get(function getId() {
  return this.legacyId || String(this._id);
});

systemLogSchema.set('toJSON', { virtuals: true });
systemLogSchema.set('toObject', { virtuals: true });

const SystemLog = mongoose.models.SystemLog || mongoose.model('SystemLog', systemLogSchema);

export default SystemLog;