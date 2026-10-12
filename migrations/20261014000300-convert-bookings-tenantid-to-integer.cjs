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

// See the users-tenantid migration for why this drop-then-add pattern is
// necessary: MySQL can silently shrink a composite index instead of fully
// dropping it when one of its columns is removed, which leaves the name
// "taken" for a plain re-add.
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

module.exports = {
  async up(queryInterface, Sequelize) {
    const bookingsColumns = await queryInterface.describeTable('bookings');
    const alreadyInteger = bookingsColumns.tenantId.type.toUpperCase().includes('INT');

    if (!alreadyInteger) {
      const query = (sql) => queryInterface.sequelize.query(sql);

      await queryInterface.addColumn('bookings', 'tenantRefId', { type: Sequelize.INTEGER, allowNull: true });
      await query(`
        UPDATE bookings b
        JOIN tenants t ON t.slug = b.tenantId
        SET b.tenantRefId = t.id
      `);

      const [countRows] = await query('SELECT COUNT(*) AS unmapped FROM bookings WHERE tenantRefId IS NULL');
      const unmapped = Number(countRows[0].unmapped);
      if (unmapped > 0) {
        throw new Error(`Cannot convert bookings.tenantId: ${unmapped} row(s) reference a tenant slug that does not exist in tenants.`);
      }

      await queryInterface.removeColumn('bookings', 'tenantId');
      await queryInterface.renameColumn('bookings', 'tenantRefId', 'tenantId');
      await queryInterface.changeColumn('bookings', 'tenantId', { type: Sequelize.INTEGER, allowNull: false });
    }

    await ensureIndex(queryInterface, 'bookings', ['tenantId'], 'bookings_tenant_id_idx', false);
    await ensureIndex(queryInterface, 'bookings', ['tenantId', 'userId', 'eventName'], 'bookings_tenant_user_event_unique', true);
    await ensureForeignKey(queryInterface, 'bookings', {
      fields: ['tenantId'],
      name: 'bookings_tenant_fk',
      references: { table: 'tenants', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });
    await ensureForeignKey(queryInterface, 'bookings', {
      fields: ['userId', 'tenantId'],
      name: 'bookings_user_tenant_fk',
      references: { table: 'users', fields: ['id', 'tenantId'] },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });
  },

  async down(queryInterface, Sequelize) {
    const query = (sql) => queryInterface.sequelize.query(sql);

    for (const name of ['bookings_user_tenant_fk', 'bookings_tenant_fk']) {
      if (await fkExists(queryInterface, 'bookings', name)) {
        await queryInterface.removeConstraint('bookings', name);
      }
    }
    for (const name of ['bookings_tenant_user_event_unique', 'bookings_tenant_id_idx']) {
      if (await indexExists(queryInterface, 'bookings', name)) {
        await queryInterface.removeIndex('bookings', name);
      }
    }

    await queryInterface.addColumn('bookings', 'tenantSlugTmp', { type: Sequelize.STRING(36), allowNull: true });
    await query(`
      UPDATE bookings b
      JOIN tenants t ON t.id = b.tenantId
      SET b.tenantSlugTmp = t.slug
    `);
    await queryInterface.removeColumn('bookings', 'tenantId');
    await queryInterface.renameColumn('bookings', 'tenantSlugTmp', 'tenantId');
    await queryInterface.changeColumn('bookings', 'tenantId', { type: Sequelize.STRING(36), allowNull: false });

    await ensureIndex(queryInterface, 'bookings', ['tenantId'], 'bookings_tenant_id_idx', false);
    await ensureIndex(queryInterface, 'bookings', ['tenantId', 'userId', 'eventName'], 'bookings_tenant_user_event_unique', true);
  }
};
