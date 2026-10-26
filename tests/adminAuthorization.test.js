import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import request from 'supertest';
import { connectMongoDB } from '../db/mongodb.js';
import sequelize from '../db/sequelize.js';
import { Tenant, User } from '../models/index.js';
import SystemLog from '../models/SystemLog.js';
import { app } from '../server.js';

const TENANT_SLUG = 'jest-admin-authz-tenant';
const STUDENT_EMAIL = 'jest-admin-authz-student@example.com';
const ADMIN_EMAIL = 'jest-admin-authz-admin@example.com';
const PASSWORD = 'JestPass123!';

describe('Admin-only authorization on GET /api/system-logs', () => {
  let tenantId;
  let studentToken;
  let adminToken;

  beforeAll(async () => {
    await connectMongoDB();
    await User.destroy({ where: { email: [STUDENT_EMAIL, ADMIN_EMAIL] } });
    await Tenant.destroy({ where: { slug: TENANT_SLUG } });
    const tenant = await Tenant.create({ slug: TENANT_SLUG, name: 'Jest Admin Authz Tenant' });
    tenantId = tenant.id;

    // Student: created through the real registration API — role defaults to 'student'.
    await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Jest Student', email: STUDENT_EMAIL, password: PASSWORD, tenantId: TENANT_SLUG });
    const studentLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: STUDENT_EMAIL, password: PASSWORD, tenantId: TENANT_SLUG });
    studentToken = studentLogin.body.token;

    // Admin: there is no HTTP endpoint that grants this role (see scripts/promote-admin.js),
    // so the row is created directly here, the same way that script would promote a user.
    await User.create({
      tenantId,
      fullName: 'Jest Admin',
      email: ADMIN_EMAIL,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      role: 'admin'
    });
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: PASSWORD, tenantId: TENANT_SLUG });
    adminToken = adminLogin.body.token;
  });

  afterAll(async () => {
    await User.destroy({ where: { tenantId } });
    await Tenant.destroy({ where: { id: tenantId } });
    await SystemLog.deleteMany({ studentName: 'Jest Routing Visitor' });
    await mongoose.connection.close();
    await sequelize.close();
  });

  test('rejects an unauthenticated request with 401', async () => {
    const response = await request(app).get('/api/system-logs');
    expect(response.status).toBe(401);
  });

  test('rejects a student (authenticated, non-admin) request with 403', async () => {
    const response = await request(app)
      .get('/api/system-logs')
      .set('Authorization', `Bearer ${studentToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.message).toBe('You do not have permission to access this resource.');
  });

  test('allows an admin request with 200', async () => {
    const response = await request(app)
      .get('/api/system-logs')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  test('a route_visit telemetry event posted via POST /api/telemetry is readable by an admin via GET /api/system-logs with the original action intact', async () => {
    const postResponse = await request(app).post('/api/telemetry').send({
      studentName: 'Jest Routing Visitor',
      eventName: '/admin/routing-analytics',
      action: 'route_visit',
      dateTime: new Date().toISOString(),
      status: 'success'
    });
    expect(postResponse.status).toBe(201);

    const logsResponse = await request(app)
      .get('/api/system-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(logsResponse.status).toBe(200);

    const match = logsResponse.body.find((entry) => entry.studentName === 'Jest Routing Visitor');
    expect(match).toBeDefined();
    expect(match.action).toBe('route_visit');
    expect(match.eventName).toBe('/admin/routing-analytics');
    expect(match.status).toBe('success');
  });

  test('POST /api/telemetry rejects a request missing required fields', async () => {
    const response = await request(app).post('/api/telemetry').send({ studentName: 'Incomplete Only' });
    expect(response.status).toBe(400);
  });

  test('a database failure reading system logs returns a clean 500 to an admin, without leaking internals', async () => {
    const spy = jest.spyOn(SystemLog, 'find').mockImplementationOnce(() => {
      throw new Error('MongoNetworkError: simulated outage');
    });

    const response = await request(app)
      .get('/api/system-logs')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(500);
    expect(response.body.error.message).toBe('Internal server error.');
    expect(response.body.error.message).not.toMatch(/MongoNetworkError|simulated/);

    spy.mockRestore();
  });
});
