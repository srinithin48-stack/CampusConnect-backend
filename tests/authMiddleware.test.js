import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { authenticate } from '../middleware/auth.js';

const SECRET = process.env.JWT_SECRET;

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('JWT authentication middleware', () => {
  test('valid token: attaches the decoded payload and calls next() with no error', async () => {
    const token = jwt.sign({ userId: 1, tenantId: 'jest-tenant', role: 'student' }, SECRET, { expiresIn: '1h' });
    const request = { headers: { authorization: `Bearer ${token}` } };
    const next = jest.fn();

    authenticate(request, {}, next);
    await flush();

    expect(next).toHaveBeenCalledWith();
    expect(request.user).toEqual({ userId: 1, tenantId: 'jest-tenant', role: 'student' });
  });

  test('missing token: calls next() with a 401 error', () => {
    const request = { headers: {} };
    const next = jest.fn();

    authenticate(request, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].status).toBe(401);
  });

  test('invalid token: calls next() with a 401 error', async () => {
    const request = { headers: { authorization: 'Bearer not-a-real-token' } };
    const next = jest.fn();

    authenticate(request, {}, next);
    await flush();

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].status).toBe(401);
  });

  test('expired token: calls next() with a 401 error', async () => {
    const expiredToken = jwt.sign({ userId: 1, tenantId: 'jest-tenant', role: 'student' }, SECRET, { expiresIn: -10 });
    const request = { headers: { authorization: `Bearer ${expiredToken}` } };
    const next = jest.fn();

    authenticate(request, {}, next);
    await flush();

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].status).toBe(401);
  });
});
