import { randomUUID } from 'node:crypto';
import { ValidationError } from 'sequelize';
import sequelize from '../db/sequelize.js';
import { User, Booking } from '../models/index.js';

const tenantId = `verify-${randomUUID().slice(0, 24)}`;
let createdUserId;

try {
  await sequelize.transaction(async (transaction) => {
    const user = await User.create({
      tenantId, fullName: 'Rollback Verification User', email: `${randomUUID()}@example.test`, passwordHash: 'verification-only'
    }, { transaction });
    createdUserId = user.id;

    await Booking.create({
      tenantId, userId: user.id, eventName: 'rollback-check', status: 'invalid-status', bookingDate: new Date()
    }, { transaction, validate: true });
  });
  throw new Error('Expected the transaction to roll back.');
} catch (error) {
  if (!(error instanceof ValidationError)) throw error;
}

const rolledBackUser = await User.findByPk(createdUserId);
if (rolledBackUser) throw new Error('Rollback verification failed: user still exists.');

console.log('Transaction verification passed: invalid booking validation rolled back the user insert.');
await sequelize.close();