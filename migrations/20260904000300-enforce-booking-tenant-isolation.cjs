module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('users', ['id', 'tenantId'], {
      unique: true,
      name: 'users_id_tenant_id_unique'
    });
    await queryInterface.addConstraint('bookings', {
      fields: ['userId', 'tenantId'],
      type: 'foreign key',
      name: 'bookings_user_tenant_fk',
      references: { table: 'users', fields: ['id', 'tenantId'] },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint('bookings', 'bookings_user_tenant_fk');
    await queryInterface.removeIndex('users', 'users_id_tenant_id_unique');
  }
};