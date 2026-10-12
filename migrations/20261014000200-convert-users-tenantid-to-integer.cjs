'use strict';

const indexExists = async (queryInterface, table, name) => {
  const [rows] = await queryInterface.sequelize.query(
    'SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND INDEX_NAME = :name',
    { replacements: { table, name } }
  );
  return Number(rows[0].cnt) > 0;
};

const fkExists = async (queryInterface, table, name) => {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND CONSTRAINT_NAME = :name AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    { replacements: { table, name } }
  );
  return Number(rows[0].cnt) > 0;
};

// MySQL doesn't always fully drop a composite index when one of its columns
// is dropped — it can silently shrink it down to the remaining column(s)
// instead, which leaves the name "taken". These helpers make every index and
// FK below idempotent: drop whatever currently answers to that name, then
// (re)create it fresh, regardless of how a previous (possibly partial) run
// left things.
const ensureIndex = async (queryInterface, table, fields, name, unique) => {
  if (await indexExists(queryInterface, table, name)) {
    await queryInterface.removeIndex(table, name);
  }
  await queryInterface.addIndex(table, fields, { name, unique });
};

const ensureForeignKey = async (queryInterface, table, options) => {
  if (await fkExists(queryInterface, table, options.name)) {
    await queryInterface.removeConstraint(table, options.name);
  }
  await queryInterface.addConstraint(table, { type: 'foreign key', ...options });
};

const ensureUserTenantConstraints = async (queryInterface) => {
  await ensureIndex(queryInterface, 'users', ['tenantId', 'email'], 'users_tenant_email_unique', true);
  await ensureIndex(queryInterface, 'users', ['tenantId'], 'users_tenant_id_idx', false);
  await ensureIndex(queryInterface, 'users', ['id', 'tenantId'], 'users_id_tenant_unique', true);
  await ensureIndex(queryInterface, 'users', ['id', 'tenantId'], 'users_id_tenant_id_unique', true);
};

module.exports = {
  async up(queryInterface, Sequelize) {
    const usersColumns = await queryInterface.describeTable('users');
    const alreadyInteger = usersColumns.tenantId.type.toUpperCase().includes('INT');

    if (!alreadyInteger) {
      const query = (sql) => queryInterface.sequelize.query(sql);

      await queryInterface.addColumn('users', 'tenantRefId', { type: Sequelize.INTEGER, allowNull: true });
      await query(`
        UPDATE users u
        JOIN tenants t ON t.slug = u.tenantId
        SET u.tenantRefId = t.id
      `);

      const [countRows] = await query('SELECT COUNT(*) AS unmapped FROM users WHERE tenantRefId IS NULL');
      const unmapped = Number(countRows[0].unmapped);
      if (unmapped > 0) {
        throw new Error(`Cannot convert users.tenantId: ${unmapped} row(s) reference a tenant slug that does not exist in tenants.`);
      }

      await queryInterface.removeColumn('users', 'tenantId');
      await queryInterface.renameColumn('users', 'tenantRefId', 'tenantId');
      await queryInterface.changeColumn('users', 'tenantId', { type: Sequelize.INTEGER, allowNull: false });
    }

    await ensureUserTenantConstraints(queryInterface);
    await ensureForeignKey(queryInterface, 'users', {
      fields: ['tenantId'],
      name: 'users_tenant_fk',
      references: { table: 'tenants', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });
  },

  async down(queryInterface, Sequelize) {
    const query = (sql) => queryInterface.sequelize.query(sql);

    if (await fkExists(queryInterface, 'users', 'users_tenant_fk')) {
      await queryInterface.removeConstraint('users', 'users_tenant_fk');
    }
    for (const name of ['users_id_tenant_id_unique', 'users_id_tenant_unique', 'users_tenant_id_idx', 'users_tenant_email_unique']) {
      if (await indexExists(queryInterface, 'users', name)) {
        await queryInterface.removeIndex('users', name);
      }
    }

    await queryInterface.addColumn('users', 'tenantSlugTmp', { type: Sequelize.STRING(36), allowNull: true });
    await query(`
      UPDATE users u
      JOIN tenants t ON t.id = u.tenantId
      SET u.tenantSlugTmp = t.slug
    `);
    await queryInterface.removeColumn('users', 'tenantId');
    await queryInterface.renameColumn('users', 'tenantSlugTmp', 'tenantId');
    await queryInterface.changeColumn('users', 'tenantId', { type: Sequelize.STRING(36), allowNull: false });

    await ensureUserTenantConstraints(queryInterface);
  }
};
