import mongoose from 'mongoose';
import SystemLog from './SystemLog.js';

const scheduleItemSchema = new mongoose.Schema({
  title: String,
  description: String,
  startTime: String,
  endTime: String,
  location: String
}, { _id: false, strict: false });

const participantSchema = new mongoose.Schema({
  name: String,
  role: String,
  email: String,
  bio: String
}, { _id: false, strict: false });

const eventSchema = new mongoose.Schema({
  legacyId: String,
  title: { type: String, required: true, trim: true },
  category: String,
  date: String,
  venue: String,
  description: String,
  details: [String],
  schedule: [scheduleItemSchema],
  speakers: [participantSchema],
  organizers: [participantSchema],
  tags: [String],
  tenantId: String,
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true, strict: false });

eventSchema.virtual('id').get(function getId() {
  return this.legacyId || String(this._id);
});

eventSchema.set('toJSON', { virtuals: true });
eventSchema.set('toObject', { virtuals: true });

const createLog = async (action, event, details = {}) => {
  try {
    await SystemLog.create({
      action,
      eventId: event._id,
      studentName: 'Admin',
      eventName: event.title,
      dateTime: new Date().toISOString(),
      status: 'Success',
      details
    });
  } catch (error) {
    console.error(`Unable to write ${action} system log:`, error.message);
  }
};

eventSchema.post('save', async (event) => {
  await createLog('EVENT_CREATED', event, { title: event.title });
});

eventSchema.post('findOneAndUpdate', async (event) => {
  if (event) await createLog('EVENT_UPDATED', event, { title: event.title });
});

eventSchema.post('findOneAndDelete', async (event) => {
  if (event) await createLog('EVENT_DELETED', event, { title: event.title });
});

const Event = mongoose.models.Event || mongoose.model('Event', eventSchema);

export default Event;