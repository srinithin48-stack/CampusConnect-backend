import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import { connectMongoDB } from '../db/mongodb.js';
import sequelize from '../db/sequelize.js';
import { Tenant, User } from '../models/index.js';
import { app } from '../server.js';

const TEST_TENANT_SLUG = 'jest-tenant';
const TEST_EMAIL = 'jest-user@example.com';
const TEST_PASSWORD = 'JestPass123!';

describe('Week 7 authentication', () => {
  let authToken;
  let tenantId; // numeric tenants.id backing the fixture tenant/slug above

  beforeAll(async () => {
    await connectMongoDB();
    await User.destroy({ where: { email: TEST_EMAIL } });
    await Tenant.destroy({ where: { slug: TEST_TENANT_SLUG } });
    // users.tenantId/bookings.tenantId are integer foreign keys into tenants,
    // so the fixture tenant has to exist before a user can be created under it.
    const tenant = await Tenant.create({ slug: TEST_TENANT_SLUG, name: 'Jest Test Tenant' });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await User.destroy({ where: { tenantId } });
    await Tenant.destroy({ where: { id: tenantId } });
  });

  test('POST /api/auth/register creates a new user', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Jest User', email: TEST_EMAIL, password: TEST_PASSWORD, tenantId: TEST_TENANT_SLUG });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      email: TEST_EMAIL,
      tenantId: TEST_TENANT_SLUG,
      role: 'student'
    });

    const user = await User.findOne({ where: { tenantId, email: TEST_EMAIL } });
    expect(user).not.toBeNull();
  });

  test('POST /api/auth/register rejects a college name that is too short', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Bad College', email: 'bad-college@example.com', password: TEST_PASSWORD, tenantId: 'X' });

    expect(response.status).toBe(400);

    const user = await User.findOne({ where: { email: 'bad-college@example.com' } });
    expect(user).toBeNull();
  });

  test('stores the password as a bcrypt hash, never in plain text', async () => {
    const user = await User.findOne({ where: { tenantId, email: TEST_EMAIL } });

    expect(user.passwordHash).not.toBe(TEST_PASSWORD);
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
    await expect(bcrypt.compare(TEST_PASSWORD, user.passwordHash)).resolves.toBe(true);
  });

  test('POST /api/auth/login succeeds with correct credentials and returns a JWT', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD, tenantId: TEST_TENANT_SLUG });

    expect(response.status).toBe(200);
    expect(typeof response.body.token).toBe('string');
    authToken = response.body.token;
  });

  test('the issued JWT verifies and carries userId, tenantId, role, and an expiration', () => {
    const payload = jwt.verify(authToken, process.env.JWT_SECRET);

    expect(payload).toMatchObject({ tenantId, role: 'student' });
    expect(typeof payload.userId).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });

  test('POST /api/auth/login rejects an incorrect password', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_EMAIL, password: 'WrongPassword', tenantId: TEST_TENANT_SLUG });

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

describe('"+ Add Other College" find-or-create behavior', () => {
  const CUSTOM_COLLEGE_NAME = 'Jest Custom College';
  const FIRST_EMAIL = 'jest-custom-college-1@example.com';
  const SECOND_EMAIL = 'jest-custom-college-2@example.com';
  const PASSWORD = 'JestPass123!';

  afterAll(async () => {
    await User.destroy({ where: { email: [FIRST_EMAIL, SECOND_EMAIL] } });
    await Tenant.destroy({ where: { name: CUSTOM_COLLEGE_NAME } });
  });

  test('registering with a brand-new college name creates a tenant and a user', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'First Student', email: FIRST_EMAIL, password: PASSWORD, tenantId: CUSTOM_COLLEGE_NAME });

    expect(response.status).toBe(201);
    expect(typeof response.body.tenantId).toBe('string');

    const tenants = await Tenant.findAll({ where: { name: CUSTOM_COLLEGE_NAME } });
    expect(tenants).toHaveLength(1);
  });

  test('registering again under the same name (different case/whitespace) reuses the tenant, never duplicates it', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        fullName: 'Second Student',
        email: SECOND_EMAIL,
        password: PASSWORD,
        tenantId: `  ${CUSTOM_COLLEGE_NAME.toUpperCase()}  `
      });

    expect(response.status).toBe(201);

    const tenants = await Tenant.findAll({ where: { name: CUSTOM_COLLEGE_NAME } });
    expect(tenants).toHaveLength(1);

    const [firstUser, secondUser] = await Promise.all([
      User.findOne({ where: { email: FIRST_EMAIL } }),
      User.findOne({ where: { email: SECOND_EMAIL } })
    ]);
    expect(secondUser.tenantId).toBe(firstUser.tenantId);
  });

  test('logging in to a custom college by its typed name succeeds without creating another tenant', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: FIRST_EMAIL, password: PASSWORD, tenantId: CUSTOM_COLLEGE_NAME.toLowerCase() });

    expect(response.status).toBe(200);
    expect(typeof response.body.token).toBe('string');

    const tenants = await Tenant.findAll({ where: { name: CUSTOM_COLLEGE_NAME } });
    expect(tenants).toHaveLength(1);
  });

  test('logging in with a college name that was never registered fails and creates nothing', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: FIRST_EMAIL, password: PASSWORD, tenantId: 'A College Nobody Ever Created' });

    expect(response.status).toBe(401);

    const tenant = await Tenant.findOne({ where: { name: 'A College Nobody Ever Created' } });
    expect(tenant).toBeNull();
  });
});

afterAll(async () => {
  await mongoose.connection.close();
  await sequelize.close();
});
