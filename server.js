import bcrypt from 'bcrypt';
import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { connectMongoDB } from './db/mongodb.js';
import sequelize from './db/sequelize.js';
import { authenticate } from './middleware/auth.js';
import Event from './models/Event.js';
import SystemLog from './models/SystemLog.js';
import { Booking, User } from './models/index.js';

const app = express();
const port = process.env.PORT || 3001;
const PASSWORD_HASH_ROUNDS = 10;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

const requestLogger = (request, response, next) => {
  console.log(`[${new Date().toISOString()}] ${request.method} ${request.originalUrl}`);
  next();
};

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
    if (![name, email, department, year, event].every((value) => typeof value === 'string' && value.trim())) {
      throw createHttpError(400, 'Name, email, department, year, and event are required.');
    }

    const resolvedTenantId = typeof tenantId === 'string' && tenantId.trim() ? tenantId.trim() : 'default-tenant';
    if (resolvedTenantId.length > 36) throw createHttpError(400, 'Tenant ID must not exceed 36 characters.');
    const normalizedTenantId = resolvedTenantId;

    const registration = await sequelize.transaction(async (transaction) => {
      const [user] = await User.findOrCreate({
        where: { tenantId: normalizedTenantId, email: email.trim().toLowerCase() },
        defaults: {
          tenantId: normalizedTenantId,
          fullName: name.trim(),
          email: email.trim().toLowerCase(),
          passwordHash: await bcrypt.hash(randomUUID(), PASSWORD_HASH_ROUNDS)
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

    try {
      await SystemLog.create({
        action: 'EVENT_REGISTERED',
        studentName: registration.name,
        eventName: registration.event,
        status: 'Confirmed',
        dateTime: new Date(registration.createdAt),
        details: {
          email: registration.email,
          department: registration.department,
          year: registration.year,
          tenantId: normalizedTenantId,
          bookingId: registration.id
        }
      });
    } catch (error) {
      console.error('Unable to write EVENT_REGISTERED system log:', error.message);
    }

    response.status(201).json(registration);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return next(createHttpError(409, 'This student is already registered for this event.'));
    }
    next(error);
  }
};

app.post(['/api/registrations', '/registrations'], createRegistration);

const createAccount = async (request, response, next) => {
  try {
    const { fullName, email, password, tenantId } = request.body ?? {};
    if (![fullName, email, password, tenantId].every((value) => typeof value === 'string' && value.trim())) {
      throw createHttpError(400, 'Full name, email, password, and college are required.');
    }

    const normalizedTenantId = tenantId.trim();
    if (normalizedTenantId.length > 36) throw createHttpError(400, 'Tenant ID must not exceed 36 characters.');
    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({ where: { tenantId: normalizedTenantId, email: normalizedEmail } });
    if (existingUser) {
      throw createHttpError(409, 'An account with this email already exists for the selected college.');
    }

    const user = await User.create({
      tenantId: normalizedTenantId,
      fullName: fullName.trim(),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, PASSWORD_HASH_ROUNDS)
    });

    response.status(201).json({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role
    });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return next(createHttpError(409, 'An account with this email already exists for the selected college.'));
    }
    next(error);
  }
};

app.post('/api/auth/register', createAccount);

const login = async (request, response, next) => {
  try {
    const { email, password, tenantId } = request.body ?? {};
    if (![email, password].every((value) => typeof value === 'string' && value.trim())) {
      throw createHttpError(400, 'Email and password are required.');
    }

    const where = { email: email.trim().toLowerCase() };
    if (typeof tenantId === 'string' && tenantId.trim()) {
      where.tenantId = tenantId.trim();
    }

    const user = await User.findOne({ where });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw createHttpError(401, 'Invalid email or password.');
    }

    const token = jwt.sign(
      { userId: user.id, tenantId: user.tenantId, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    user.lastLoginAt = new Date();
    await user.save();

    response.json({ token });
  } catch (error) {
    next(error);
  }
};

app.post('/api/auth/login', login);

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

app.get('/api/system-logs', authenticate, getSystemLogs);

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

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((error) => console.error('Unable to start CampusConnect:', error.message));
}

export { app };
