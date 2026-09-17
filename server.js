import cors from 'cors';
import { createHash } from 'node:crypto';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectMongoDB } from './db/mongodb.js';
import sequelize from './db/sequelize.js';
import Event from './models/Event.js';
import SystemLog from './models/SystemLog.js';
import { Booking, User } from './models/index.js';

const app = express();
const port = process.env.PORT || 3001;
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.resolve(currentDirectory, 'db.json');

const requestLogger = (request, response, next) => {
  console.log(`[${new Date().toISOString()}] ${request.method} ${request.originalUrl}`);
  next();
};

const readDatabase = async () => {
  const content = await readFile(databasePath, 'utf8');
  return JSON.parse(content);
};

const saveDatabase = (database) => writeFile(databasePath, `${JSON.stringify(database, null, 2)}\n`);

const createHttpError = (status, message) => Object.assign(new Error(message), { status });

app.use(requestLogger);
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://campusconnect-frontend.netlify.app'
];

app.use(cors({
  origin: allowedOrigins
}));

app.use(express.json());

const getEvents = async (request, response, next) => {
  try {
    response.json(await Event.find().sort({ createdAt: -1 }));
  } catch (error) {
    next(error);
  }
};

app.get(['/api/events', '/events'], getEvents);

const createEvent = async (request, response, next) => {
  try {
    const event = await Event.create(request.body ?? {});
    response.status(201).json(event);
  } catch (error) {
    next(error);
  }
};

app.post('/api/events', createEvent);

const getEvent = async (request, response, next) => {
  try {
    const event = await Event.findById(request.params.id);
    if (!event) throw createHttpError(404, 'Event not found.');
    response.json(event);
  } catch (error) {
    next(error.name === 'CastError' ? createHttpError(400, 'Invalid event ID.') : error);
  }
};

app.get('/api/events/:id', getEvent);

const updateEvent = async (request, response, next) => {
  try {
    const event = await Event.findByIdAndUpdate(
      request.params.id,
      request.body ?? {},
      { new: true, runValidators: true }
    );
    if (!event) throw createHttpError(404, 'Event not found.');
    response.json(event);
  } catch (error) {
    next(error.name === 'CastError' ? createHttpError(400, 'Invalid event ID.') : error);
  }
};

app.put('/api/events/:id', updateEvent);

const createRegistration = async (request, response, next) => {
  try {
    const { name, email, department, year, event, createdAt, tenantId } = request.body ?? {};
    if (![name, email, department, year, event, tenantId].every((value) => typeof value === 'string' && value.trim())) {
      throw createHttpError(400, 'Name, email, department, year, event, and tenantId are required.');
    }

    const normalizedTenantId = tenantId.trim();
    if (normalizedTenantId.length > 36) throw createHttpError(400, 'Tenant ID must not exceed 36 characters.');

    const registration = await sequelize.transaction(async (transaction) => {
      const [user] = await User.findOrCreate({
        where: { tenantId: normalizedTenantId, email: email.trim().toLowerCase() },
        defaults: {
          tenantId: normalizedTenantId,
          fullName: name.trim(),
          email: email.trim().toLowerCase(),
          passwordHash: createHash('sha256').update(randomUUID()).digest('hex')
        },
        transaction
      });

      const booking = await Booking.create({
        tenantId: normalizedTenantId,
        userId: user.id,
        eventName: event.trim(),
        bookingDate: createdAt || new Date(),
        notes: JSON.stringify({ department: department.trim(), year: year.trim() })
      }, { transaction, validate: true });

      return {
        id: String(booking.id),
        name: user.fullName,
        email: user.email,
        department: department.trim(),
        year: year.trim(),
        event: booking.eventName,
        createdAt: booking.bookingDate.toISOString()
      };
    });

    response.status(201).json(registration);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return next(createHttpError(409, 'This student is already registered for this event.'));
    }
    next(error);
  }
};

app.post(['/api/registrations', '/registrations'], createRegistration);

const getTelemetry = async (request, response, next) => {
  try {
    const telemetry = await SystemLog.find({ action: 'TELEMETRY' })
      .sort({ createdAt: 1 });
    response.json(telemetry.map((record) => {
      const { _id, __v, action, details, createdAt, updatedAt, legacyId, ...fields } = record.toObject({ virtuals: true });
      return { ...fields, id: legacyId || String(_id) };
    }));
  } catch (error) {
    next(error);
  }
};

app.get(['/api/telemetry', '/telemetry'], getTelemetry);

const createTelemetry = async (request, response, next) => {
  try {
    const { studentName, eventName, action, dateTime, status } = request.body ?? {};
    if (![studentName, eventName, action, dateTime, status].every((value) => typeof value === 'string' && value.trim())) {
      throw createHttpError(400, 'Student name, event name, action, date/time, and status are required.');
    }

    const telemetryRecord = { id: randomUUID(), studentName, eventName, action, dateTime, status };
    const systemLog = await SystemLog.create({
      ...telemetryRecord,
      legacyId: telemetryRecord.id,
      action: 'TELEMETRY',
      details: telemetryRecord
    });
    response.status(201).json(telemetryRecord);
  } catch (error) {
    next(error);
  }
};

app.post(['/api/telemetry', '/telemetry'], createTelemetry);

const getSystemLogs = async (request, response, next) => {
  try {
    const logs = await SystemLog.find().sort({ createdAt: -1 });
    response.json(logs.map((record) => {
      const { _id, __v, createdAt, updatedAt, legacyId, details, ...fields } = record.toObject({ virtuals: true });
      const merged = details && typeof details === 'object' && Object.keys(details).length
        ? { ...fields, ...details }
        : fields;
      return { ...merged, id: legacyId || String(_id) };
    }));
  } catch (error) {
    next(error);
  }
};

app.get('/api/system-logs', getSystemLogs);

app.delete('/api/events/:id', async (request, response, next) => {
  try {
    const deletedEvent = await Event.findByIdAndDelete(request.params.id).lean();
    if (!deletedEvent) throw createHttpError(404, 'Event not found.');
    response.json({ message: 'Event deleted successfully.', event: deletedEvent });
  } catch (error) {
    next(error.name === 'CastError' ? createHttpError(400, 'Invalid event ID.') : error);
  }
});

app.use((request, response, next) => {
  next(createHttpError(404, `Route ${request.method} ${request.originalUrl} was not found.`));
});

app.use((error, request, response, next) => {
  const status = error.type === 'entity.parse.failed' || error.name === 'ValidationError'
    ? 400
    : error.status || 500;
  if (status === 500) console.error(error);
  response.status(status).json({
    error: {
      status,
      message: status === 500 ? 'Internal server error.' : error.message || 'Invalid JSON request body.'
    }
  });
});

const startServer = async () => {
  const [mysqlResult, mongoResult] = await Promise.allSettled([
    sequelize.authenticate(),
    connectMongoDB()
  ]);

  if (mysqlResult.status === 'fulfilled') {
    console.log('MySQL connection established.');
  } else {
    console.error('Unable to connect to MySQL:', mysqlResult.reason.message);
  }

  if (mongoResult.status === 'rejected') {
    console.error('Unable to connect to MongoDB:', mongoResult.reason.message);
  }

  app.listen(port, () => {
    console.log(`CampusConnect Express API is running at http://localhost:${port}`);
  });
};

startServer().catch((error) => console.error('Unable to start CampusConnect:', error.message));
