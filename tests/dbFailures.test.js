import mongoose from 'mongoose';
import request from 'supertest';
import sequelize from '../db/sequelize.js';
import { connectMongoDB } from '../db/mongodb.js';
import Event from '../models/Event.js';
import { User } from '../models/index.js';
import { app } from '../server.js';

describe('Database failure handling', () => {
  beforeAll(async () => {
    await connectMongoDB();
  });

  afterAll(async () => {
    await mongoose.connection.close();
    await sequelize.close();
  });

  test('a MySQL failure during login returns a clean 500 without leaking internals', async () => {
    const spy = jest.spyOn(User, 'findOne').mockRejectedValueOnce(new Error('ECONNREFUSED: simulated MySQL outage'));

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'anyone@example.com', password: 'whatever123', tenantId: 'default-tenant' });

    expect(response.status).toBe(500);
    expect(response.body.error.message).toBe('Internal server error.');
    expect(response.body.error.message).not.toMatch(/ECONNREFUSED|simulated/);

    spy.mockRestore();
  });

  test('a MongoDB failure listing events returns a clean 500 without leaking internals', async () => {
    const spy = jest.spyOn(Event, 'find').mockImplementationOnce(() => {
      throw new Error('MongoNetworkError: simulated Mongo outage');
    });

    const response = await request(app).get('/api/events');

    expect(response.status).toBe(500);
    expect(response.body.error.message).toBe('Internal server error.');
    expect(response.body.error.message).not.toMatch(/MongoNetworkError|simulated/);

    spy.mockRestore();
  });
});
