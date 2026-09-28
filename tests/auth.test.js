import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { connectMongoDB } from '../db/mongodb.js';
import sequelize from '../db/sequelize.js';
import { User } from '../models/index.js';
import { app } from '../server.js';

const TEST_TENANT_ID = 'jest-tenant';
const TEST_EMAIL = 'jest-user@example.com';
const TEST_PASSWORD = 'JestPass123!';

describe('Week 7 authentication', () => {
  let authToken;

  beforeAll(async () => {
    await connectMongoDB();
    await User.destroy({ where: { tenantId: TEST_TENANT_ID, email: TEST_EMAIL } });
  });

  afterAll(async () => {
    await User.destroy({ where: { tenantId: TEST_TENANT_ID, email: TEST_EMAIL } });
    await mongoose.connection.close();
    await sequelize.close();
  });

  test('POST /api/auth/register creates a new user', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Jest User', email: TEST_EMAIL, password: TEST_PASSWORD, tenantId: TEST_TENANT_ID });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      email: TEST_EMAIL,
      tenantId: TEST_TENANT_ID,
      role: 'student'
    });

    const user = await User.findOne({ where: { tenantId: TEST_TENANT_ID, email: TEST_EMAIL } });
    expect(user).not.toBeNull();
  });

  test('stores the password as a bcrypt hash, never in plain text', async () => {
    const user = await User.findOne({ where: { tenantId: TEST_TENANT_ID, email: TEST_EMAIL } });

    expect(user.passwordHash).not.toBe(TEST_PASSWORD);
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
    await expect(bcrypt.compare(TEST_PASSWORD, user.passwordHash)).resolves.toBe(true);
  });

  test('POST /api/auth/login succeeds with correct credentials and returns a JWT', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD, tenantId: TEST_TENANT_ID });

    expect(response.status).toBe(200);
    expect(typeof response.body.token).toBe('string');
    authToken = response.body.token;
  });

  test('the issued JWT verifies and carries userId, tenantId, role, and an expiration', () => {
    const payload = jwt.verify(authToken, process.env.JWT_SECRET);

    expect(payload).toMatchObject({ tenantId: TEST_TENANT_ID, role: 'student' });
    expect(typeof payload.userId).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });

  test('POST /api/auth/login rejects an incorrect password', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'WrongPassword', tenantId: TEST_TENANT_ID });

    expect(response.status).toBe(401);
  });

  test('GET /api/system-logs returns 401 without a token', async () => {
    const response = await request(app).get('/api/system-logs');
    expect(response.status).toBe(401);
  });

  test('GET /api/system-logs returns 401 with an invalid token', async () => {
    const response = await request(app)
      .get('/api/system-logs')
      .set('Authorization', 'Bearer not-a-real-token');

    expect(response.status).toBe(401);
  });

  test('GET /api/system-logs returns 200 with a valid token', async () => {
    const response = await request(app)
      .get('/api/system-logs')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
