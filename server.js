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
import { Booking, Tenant, User } from './models/index.js';

const app = express();
const port = process.env.PORT || 3001;
const PASSWORD_HASH_ROUNDS = 10;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';
const COLLEGES_API_URL = 'https://colleges-api.vercel.app/colleges';
const COLLEGES_API_TIMEOUT_MS = 8000;
const COLLEGE_SEARCH_MIN_LENGTH = 3;
const COLLEGE_NAME_MIN_LENGTH = 2;
const COLLEGE_NAME_MAX_LENGTH = 150;
const PASSWORD_MIN_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const slugifyCollegeName = (name) => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  return slug || 'college';
};

// A college identifier from the client is either a known dropdown slug
// ('psg') or a freely-typed college name ('+ Add Other College'). Try the
// slug first, then fall back to a case-insensitive name match.
const findTenantByIdentifier = async (identifier, { transaction } = {}) => {
  const value = identifier.trim();
  const bySlug = await Tenant.findOne({ where: { slug: value }, transaction });
  if (bySlug) return bySlug;

  return Tenant.findOne({
    where: sequelize.where(sequelize.fn('LOWER', sequelize.col('name')), value.toLowerCase()),
    transaction
  });
};

const resolveOrCreateTenant = async (identifier, { transaction } = {}) => {
  const name = identifier.trim();
  const existing = await findTenantByIdentifier(name, { transaction });
  if (existing) return existing;

  const slug = slugifyCollegeName(name);
  try {
    return await Tenant.create({ slug, name }, { transaction });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      const recovered = (await findTenantByIdentifier(name, { transaction }))
        || (await Tenant.findOne({ where: { slug }, transaction }));
      if (recovered) return recovered;
    }
    throw error;
  }
};

const requestLogger = (request, response, next) => {
  console.log(`[${new Date().toISOString()}] ${request.method} ${request.originalUrl}`);
  next();
};

const createHttpError = (status, message) => Object.assign(new Error(message), { status });

// Mongoose's Model.create()/findByIdAndUpdate() treat an array body as a bulk
// operation rather than a single document, so reject anything that isn't a
// plain JSON object up front.
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

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
    if (!isPlainObject(request.body)) {
      throw createHttpError(400, 'Request body must be a JSON object.');
    }
    const event = await Event.create(request.body);
    response.status(201).json(event);
  } catch (error) {
    next(error);
  }
};

app.post('/api/events', authenticate, createEvent);

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
    if (!isPlainObject(request.body)) {
      throw createHttpError(400, 'Request body must be a JSON object.');
    }
    const event = await Event.findByIdAndUpdate(
      request.params.id,
      request.body,
      { new: true, runValidators: true }
    );
    if (!event) throw createHttpError(404, 'Event not found.');
    response.json(event);
  } catch (error) {
    next(error.name === 'CastError' ? createHttpError(400, 'Invalid event ID.') : error);
  }
};

app.put('/api/events/:id', authenticate, updateEvent);

const searchColleges = async (request, response, next) => {
  try {
    const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
    if (query.length < COLLEGE_SEARCH_MIN_LENGTH) {
      throw createHttpError(400, `Search query must be at least ${COLLEGE_SEARCH_MIN_LENGTH} characters long.`);
    }

    const upstreamUrl = `${COLLEGES_API_URL}?search=${encodeURIComponent(query)}`;
    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstreamUrl, { signal: AbortSignal.timeout(COLLEGES_API_TIMEOUT_MS) });
    } catch (error) {
      throw createHttpError(502, 'Unable to reach the college search service.');
    }

    if (!upstreamResponse.ok) {
      throw createHttpError(502, 'The college search service returned an error.');
    }

    let payload;
    try {
      payload = await upstreamResponse.json();
    } catch (error) {
      throw createHttpError(502, 'The college search service returned an invalid response.');
    }

    const results = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

    response.json({ query, results });
  } catch (error) {
    next(error);
  }
};

app.get('/api/colleges/search', searchColleges);

const createRegistration = async (request, response, next) => {
  try {
    const { name, email, department, year, event, createdAt, tenantId } = request.body ?? {};
    if (![name, email, department, year, event].every((value) => typeof value === 'string' && value.trim())) {
      throw createHttpError(400, 'Name, email, department, year, and event are required.');
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      throw createHttpError(400, 'Enter a valid email address.');
    }

    const resolvedTenantName = typeof tenantId === 'string' && tenantId.trim() ? tenantId.trim() : 'default-tenant';
    if (resolvedTenantName.length < COLLEGE_NAME_MIN_LENGTH || resolvedTenantName.length > COLLEGE_NAME_MAX_LENGTH) {
      throw createHttpError(400, `College name must be between ${COLLEGE_NAME_MIN_LENGTH} and ${COLLEGE_NAME_MAX_LENGTH} characters.`);
    }

    let tenantSlugForLog;
    const registration = await sequelize.transaction(async (transaction) => {
      const tenant = await resolveOrCreateTenant(resolvedTenantName, { transaction });
      tenantSlugForLog = tenant.slug;

      const [user] = await User.findOrCreate({
        where: { tenantId: tenant.id, email: email.trim().toLowerCase() },
        defaults: {
          tenantId: tenant.id,
          fullName: name.trim(),
          email: email.trim().toLowerCase(),
          passwordHash: await bcrypt.hash(randomUUID(), PASSWORD_HASH_ROUNDS)
        },
        transaction
      });

      const booking = await Booking.create({
        tenantId: tenant.id,
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
          tenantId: tenantSlugForLog,
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
    if (error.name === 'SequelizeForeignKeyConstraintError') {
      return next(createHttpError(400, 'Selected college is not recognized.'));
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
    if (!EMAIL_PATTERN.test(email.trim())) {
      throw createHttpError(400, 'Enter a valid email address.');
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      throw createHttpError(400, `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`);
    }

    const tenantName = tenantId.trim();
    if (tenantName.length < COLLEGE_NAME_MIN_LENGTH || tenantName.length > COLLEGE_NAME_MAX_LENGTH) {
      throw createHttpError(400, `College name must be between ${COLLEGE_NAME_MIN_LENGTH} and ${COLLEGE_NAME_MAX_LENGTH} characters.`);
    }
    const normalizedEmail = email.trim().toLowerCase();

    const { user, tenant } = await sequelize.transaction(async (transaction) => {
      const resolvedTenant = await resolveOrCreateTenant(tenantName, { transaction });

      const existingUser = await User.findOne({
        where: { tenantId: resolvedTenant.id, email: normalizedEmail },
        transaction
      });
      if (existingUser) {
        throw createHttpError(409, 'An account with this email already exists for the selected college.');
      }

      const createdUser = await User.create({
        tenantId: resolvedTenant.id,
        fullName: fullName.trim(),
        email: normalizedEmail,
        passwordHash: await bcrypt.hash(password, PASSWORD_HASH_ROUNDS)
      }, { transaction });

      return { user: createdUser, tenant: resolvedTenant };
    });

    response.status(201).json({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      tenantId: tenant.slug,
      role: user.role
    });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return next(createHttpError(409, 'An account with this email already exists for the selected college.'));
    }
    if (error.name === 'SequelizeForeignKeyConstraintError') {
      return next(createHttpError(400, 'Selected college is not recognized.'));
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
      const tenant = await findTenantByIdentifier(tenantId.trim());
      if (!tenant) throw createHttpError(401, 'Invalid email or password.');
      where.tenantId = tenant.id;
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

app.delete('/api/events/:id', authenticate, async (request, response, next) => {
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

const VALIDATION_ERROR_NAMES = new Set(['ValidationError', 'SequelizeValidationError']);

app.use((error, request, response, next) => {
  const status = error.type === 'entity.parse.failed' || VALIDATION_ERROR_NAMES.has(error.name)
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
