import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectMongoDB } from '../db/mongodb.js';
import Event from '../models/Event.js';
import SystemLog from '../models/SystemLog.js';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.resolve(currentDirectory, '..', 'db.json');

const seedMongoDB = async () => {
  const database = JSON.parse(await readFile(databasePath, 'utf8'));
  await connectMongoDB();

  let importedEvents = 0;
  for (const event of database.events ?? []) {
    const result = await Event.updateOne(
      { legacyId: String(event.id) },
      { $setOnInsert: { ...event, legacyId: String(event.id) } },
      { upsert: true }
    );
    if (result.upsertedCount) importedEvents += 1;
  }

  let importedSystemLogs = 0;
  for (const telemetry of database.telemetry ?? []) {
    const legacyId = telemetry.id ? String(telemetry.id) : undefined;
    const result = await SystemLog.updateOne(
      legacyId ? { legacyId } : { legacyId: { $exists: false }, action: 'TELEMETRY', details: telemetry },
      {
        $setOnInsert: {
          ...telemetry,
          legacyId,
          action: 'TELEMETRY',
          details: telemetry
        }
      },
      { upsert: true }
    );
    if (result.upsertedCount) importedSystemLogs += 1;
  }

  console.log(`MongoDB seed complete: ${importedEvents} events and ${importedSystemLogs} system logs imported.`);
};

seedMongoDB()
  .catch((error) => {
    console.error('MongoDB seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect();
  });
