'use strict';

// The known colleges the frontend's college dropdown already sends as
// `tenantId` (see EventFlow/src/api/colleges.js), plus the generic fallback
// tenant that server.js defaults to when no college is supplied.
const KNOWN_TENANTS = [
  { id: 'default-tenant', name: 'Default Tenant' },
  { id: 'psna', name: 'PSNA College of Engineering and Technology' },
  { id: 'anna-university', name: 'Anna University' },
  { id: 'psg', name: 'PSG College of Technology' },
  { id: 'loyola', name: 'Loyola College' },
  { id: 'mcc', name: 'Madras Christian College' },
  { id: 'srm', name: 'SRM Institute of Science and Technology' },
  { id: 'vit', name: 'VIT Vellore' },
  { id: 'kct', name: 'Kumaraguru College of Technology' }
];

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!(await queryInterface.tableExists('tenants'))) {
      await queryInterface.createTable('tenants', {
        id: { type: Sequelize.STRING(36), allowNull: false, primaryKey: true },
        name: { type: Sequelize.STRING(150), allowNull: false },
        createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
    }

    const now = new Date();
    await queryInterface.bulkInsert(
      'tenants',
      KNOWN_TENANTS.map((tenant) => ({ ...tenant, createdAt: now, updatedAt: now })),
      { ignoreDuplicates: true }
    );

    // Safety net: back-fill any tenantId already present in users/bookings
    // that isn't one of the known colleges above (e.g. data created before
    // this migration existed), so no existing row is ever orphaned once the
    // foreign keys are added in the next migration.
    await queryInterface.sequelize.query(`
      INSERT INTO tenants (id, name, createdAt, updatedAt)
      SELECT DISTINCT u.tenantId, u.tenantId, NOW(), NOW()
      FROM users u
      LEFT JOIN tenants t ON t.id = u.tenantId
      WHERE t.id IS NULL
    `);

    await queryInterface.sequelize.query(`
      INSERT INTO tenants (id, name, createdAt, updatedAt)
      SELECT DISTINCT b.tenantId, b.tenantId, NOW(), NOW()
      FROM bookings b
      LEFT JOIN tenants t ON t.id = b.tenantId
      WHERE t.id IS NULL
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tenants');
  }
};
