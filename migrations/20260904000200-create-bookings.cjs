module.exports = {
  async up(queryInterface, Sequelize) {
    if (await queryInterface.tableExists('bookings')) return;
    await queryInterface.createTable('bookings', {
      id: { type: Sequelize.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
      tenantId: { type: Sequelize.STRING(36), allowNull: false },
      userId: { type: Sequelize.INTEGER, allowNull: false },
      eventName: { type: Sequelize.STRING(150), allowNull: false },
      status: { type: Sequelize.ENUM('pending', 'confirmed', 'cancelled'), allowNull: false, defaultValue: 'pending' },
      bookingDate: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      notes: { type: Sequelize.TEXT, allowNull: true },
      totalAmount: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      deletedAt: { type: Sequelize.DATE, allowNull: true }
    });

    await queryInterface.addConstraint('bookings', {
      fields: ['userId'], type: 'foreign key', name: 'bookings_user_fk',
      references: { table: 'users', field: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT'
    });
    await queryInterface.addConstraint('bookings', {
      fields: ['tenantId', 'userId', 'eventName'], type: 'unique', name: 'bookings_tenant_user_event_unique'
    });
    await queryInterface.addIndex('bookings', ['tenantId'], { name: 'bookings_tenant_id_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('bookings');
  }
};