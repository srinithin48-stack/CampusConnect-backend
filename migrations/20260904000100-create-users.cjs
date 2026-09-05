module.exports = {
  async up(queryInterface, Sequelize) {
    if (await queryInterface.tableExists('users')) return;
    await queryInterface.createTable('users', {
      id: { type: Sequelize.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
      tenantId: { type: Sequelize.STRING(36), allowNull: false },
      fullName: { type: Sequelize.STRING(150), allowNull: false },
      email: { type: Sequelize.STRING(255), allowNull: false },
      passwordHash: { type: Sequelize.STRING(255), allowNull: false },
      role: { type: Sequelize.ENUM('admin', 'student', 'staff'), allowNull: false, defaultValue: 'student' },
      status: { type: Sequelize.ENUM('active', 'inactive', 'pending'), allowNull: false, defaultValue: 'active' },
      lastLoginAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      deletedAt: { type: Sequelize.DATE, allowNull: true }
    });

    await queryInterface.addConstraint('users', {
      fields: ['tenantId', 'email'], type: 'unique', name: 'users_tenant_email_unique'
    });
    await queryInterface.addIndex('users', ['tenantId'], { name: 'users_tenant_id_idx' });
    await queryInterface.addIndex('users', ['id', 'tenantId'], { unique: true, name: 'users_id_tenant_unique' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
  }
};