import cors from 'cors';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  'http://localhost:5173',
  'https://campusconnect-frontend.netlify.app'
];

app.use(cors({
  origin: allowedOrigins
}));

app.use(express.json());

app.get('/api/events', async (request, response, next) => {
  try {
    const database = await readDatabase();
    response.json(database.events ?? []);
  } catch (error) {
    next(error);
  }
});

app.post('/api/registrations', async (request, response, next) => {
  try {
    const { name, email, department, year, event, createdAt } = request.body ?? {};
    if (![name, email, department, year, event].every((value) => typeof value === 'string' && value.trim())) {
      throw createHttpError(400, 'Name, email, department, year, and event are required.');
    }

    const database = await readDatabase();
    const registration = { id: randomUUID(), name, email, department, year, event, createdAt: createdAt || new Date().toISOString() };
    database.registrations = [...(database.registrations ?? []), registration];
    await saveDatabase(database);
    response.status(201).json(registration);
  } catch (error) {
    next(error);
  }
});

app.get('/api/telemetry', async (request, response, next) => {
  try {
    const database = await readDatabase();
    response.json(database.telemetry ?? []);
  } catch (error) {
    next(error);
  }
});

app.post('/api/telemetry', async (request, response, next) => {
  try {
    const { studentName, eventName, action, dateTime, status } = request.body ?? {};
    if (![studentName, eventName, action, dateTime, status].every((value) => typeof value === 'string' && value.trim())) {
      throw createHttpError(400, 'Student name, event name, action, date/time, and status are required.');
    }

    const database = await readDatabase();
    const telemetryRecord = { id: randomUUID(), studentName, eventName, action, dateTime, status };
    database.telemetry = [...(database.telemetry ?? []), telemetryRecord];
    await saveDatabase(database);
    response.status(201).json(telemetryRecord);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/events/:id', async (request, response, next) => {
  try {
    const database = await readDatabase();
    const eventIndex = (database.events ?? []).findIndex((event) => String(event.id) === request.params.id);
    if (eventIndex === -1) throw createHttpError(404, 'Event not found.');

    const [deletedEvent] = database.events.splice(eventIndex, 1);
    await saveDatabase(database);
    response.json({ message: 'Event deleted successfully.', event: deletedEvent });
  } catch (error) {
    next(error);
  }
});

app.use((request, response, next) => {
  next(createHttpError(404, `Route ${request.method} ${request.originalUrl} was not found.`));
});

app.use((error, request, response, next) => {
  const status = error.type === 'entity.parse.failed' ? 400 : error.status || 500;
  if (status === 500) console.error(error);
  response.status(status).json({
    error: {
      status,
      message: status === 500 ? 'Internal server error.' : error.message || 'Invalid JSON request body.'
    }
  });
});

app.listen(port, () => {
  console.log(`CampusConnect Express API is running at http://localhost:${port}`);
});
