import { randomUUID } from 'node:crypto';
import { ValidationError } from 'sequelize';
import sequelize from '../db/sequelize.js';
import { User, Booking, Tenant } from '../models/index.js';

const tenantSlug = `verify-${randomUUID().slice(0, 24)}`;
let createdUserId;

// users.tenantId/bookings.tenantId are integer foreign keys into tenants now,
// so this script needs a real tenant row before it can exercise the rollback
// check.
const tenant = await Tenant.create({ slug: tenantSlug, name: 'Rollback Verification Tenant' });
const tenantId = tenant.id;

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

await Tenant.destroy({ where: { id: tenant.id } });

console.log('Transaction verification passed: invalid booking validation rolled back the user insert.');
await sequelize.close();