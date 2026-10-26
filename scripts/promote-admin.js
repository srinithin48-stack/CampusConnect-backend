import sequelize from '../db/sequelize.js';
import { User } from '../models/index.js';

// There is no HTTP endpoint for granting the 'admin' role — self-service
// account creation always makes a 'student'. This script is the only way to
// get an actual admin account, for real use and for tests of admin-only APIs.
const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/promote-admin.js <email> [tenantId]');
  process.exitCode = 1;
  await sequelize.close();
  process.exit();
}

const tenantId = process.argv[3] ? Number(process.argv[3]) : undefined;
const where = tenantId ? { email: email.trim().toLowerCase(), tenantId } : { email: email.trim().toLowerCase() };

const user = await User.findOne({ where });
if (!user) {
  console.error(`No user found for ${email}${tenantId ? ` in tenant ${tenantId}` : ''}.`);
  process.exitCode = 1;
  await sequelize.close();
  process.exit();
}

user.role = 'admin';
await user.save();

console.log(`Promoted user ${user.id} (${user.email}, tenant ${user.tenantId}) to role 'admin'.`);
await sequelize.close();
