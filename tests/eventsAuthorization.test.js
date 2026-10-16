import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import sequelize from '../db/sequelize.js';
import { connectMongoDB } from '../db/mongodb.js';
import Event from '../models/Event.js';
import { app } from '../server.js';

const EVENT_TITLE = 'Jest Auth Event';
const validToken = () => jwt.sign({ userId: 1, tenantId: 1, role: 'student' }, process.env.JWT_SECRET, { expiresIn: '1h' });

describe('Unauthorized request handling for event management', () => {
  let createdEventId;

  beforeAll(async () => {
    await connectMongoDB();
    await Event.deleteMany({ title: EVENT_TITLE });
  });

  afterAll(async () => {
    if (createdEventId) await Event.findByIdAndDelete(createdEventId);
    await Event.deleteMany({ title: EVENT_TITLE });
    await mongoose.connection.close();
    await sequelize.close();
  });

  test('POST /api/events without a token returns 401 and creates nothing', async () => {
    const response = await request(app).post('/api/events').send({ title: EVENT_TITLE });
    expect(response.status).toBe(401);

    const event = await Event.findOne({ title: EVENT_TITLE });
    expect(event).toBeNull();
  });

  test('POST /api/events with an invalid token returns 401', async () => {
    const response = await request(app)
      .post('/api/events')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ title: EVENT_TITLE });

    expect(response.status).toBe(401);
  });

  test('POST /api/events with a valid token succeeds', async () => {
    const response = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${validToken()}`)
      .send({ title: EVENT_TITLE, category: 'Technical' });

    expect(response.status).toBe(201);
    createdEventId = response.body._id || response.body.id;
    expect(createdEventId).toBeTruthy();
  });

  test('PUT /api/events/:id without a token returns 401 and does not modify the event', async () => {
    const response = await request(app)
      .put(`/api/events/${createdEventId}`)
      .send({ title: 'Hacked Title' });

    expect(response.status).toBe(401);

    const event = await Event.findById(createdEventId);
    expect(event.title).toBe(EVENT_TITLE);
  });

  test('DELETE /api/events/:id without a token returns 401 and does not delete the event', async () => {
    const response = await request(app).delete(`/api/events/${createdEventId}`);
    expect(response.status).toBe(401);

    const event = await Event.findById(createdEventId);
    expect(event).not.toBeNull();
  });

  test('DELETE /api/events/:id with a valid token succeeds', async () => {
    const response = await request(app)
      .delete(`/api/events/${createdEventId}`)
      .set('Authorization', `Bearer ${validToken()}`);

    expect(response.status).toBe(200);
    const event = await Event.findById(createdEventId);
    expect(event).toBeNull();
    createdEventId = null;
  });
});
