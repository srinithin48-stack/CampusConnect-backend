import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import sequelize from '../db/sequelize.js';
import { connectMongoDB } from '../db/mongodb.js';
import { Tenant, User, Booking } from '../models/index.js';
import { app } from '../server.js';

const TENANT_SLUG = 'jest-validation-tenant';
const EVENT_NAME = 'Jest Validation Event';

describe('Invalid input handling', () => {
  let tenantId;

  beforeAll(async () => {
    await connectMongoDB();
    await Tenant.destroy({ where: { slug: TENANT_SLUG } });
    const tenant = await Tenant.create({ slug: TENANT_SLUG, name: 'Jest Validation Tenant' });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await Booking.destroy({ where: { tenantId } });
    await User.destroy({ where: { tenantId } });
    await Tenant.destroy({ where: { id: tenantId } });
    const { default: SystemLog } = await import('../models/SystemLog.js');
    await SystemLog.deleteMany({ eventName: EVENT_NAME });
    await mongoose.connection.close();
    await sequelize.close();
  });

  test('POST /api/auth/register rejects a malformed email', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Bad Email', email: 'not-an-email', password: 'ValidPass123!', tenantId: TENANT_SLUG });

    expect(response.status).toBe(400);
    const user = await User.findOne({ where: { tenantId, email: 'not-an-email' } });
    expect(user).toBeNull();
  });

  test('POST /api/auth/register rejects a password shorter than 8 characters', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Short Pass', email: 'shortpass@example.com', password: 'abc123', tenantId: TENANT_SLUG });

    expect(response.status).toBe(400);
    const user = await User.findOne({ where: { email: 'shortpass@example.com' } });
    expect(user).toBeNull();
  });

  test('POST /api/registrations rejects a malformed email', async () => {
    const response = await request(app)
      .post('/api/registrations')
      .send({
        name: 'Bad Email Student',
        email: 'nope@',
        department: 'CS',
        year: '2',
        event: EVENT_NAME,
        tenantId: TENANT_SLUG
      });

    expect(response.status).toBe(400);
  });

  test('POST /api/registrations rejects missing required fields', async () => {
    const response = await request(app)
      .post('/api/registrations')
      .send({ email: 'incomplete@example.com' });

    expect(response.status).toBe(400);
  });

  test('POST /api/events rejects a non-object (array) request body', async () => {
    const token = jwt.sign({ userId: 1, tenantId, role: 'student' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    const response = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${token}`)
      .send([{ title: 'Should not be created' }]);

    expect(response.status).toBe(400);
  });

  test('POST /api/registrations prevents a duplicate booking for the same student and event', async () => {
    const payload = {
      name: 'Duplicate Student',
      email: 'duplicate-student@example.com',
      department: 'CS',
      year: '2',
      event: EVENT_NAME,
      tenantId: TENANT_SLUG
    };

    const first = await request(app).post('/api/registrations').send(payload);
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/registrations').send(payload);
    expect(second.status).toBe(409);

    const bookings = await Booking.findAll({ where: { tenantId, eventName: EVENT_NAME } });
    expect(bookings).toHaveLength(1);
  });
});
