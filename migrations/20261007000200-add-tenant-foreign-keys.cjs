'use strict';

module.exports = {
  async up(queryInterface) {
    await queryInterface.addConstraint('users', {
      fields: ['tenantId'],
      type: 'foreign key',
      name: 'users_tenant_fk',
      references: { table: 'tenants', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });

    await queryInterface.addConstraint('bookings', {
      fields: ['tenantId'],
      type: 'foreign key',
      name: 'bookings_tenant_fk',
      references: { table: 'tenants', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('bookings', 'bookings_tenant_fk');
    await queryInterface.removeConstraint('users', 'users_tenant_fk');
  }
};
