'use strict';

module.exports = {
  async up(queryInterface) {
    const tenantsColumns = await queryInterface.describeTable('tenants');
    if (tenantsColumns.slug) return;

    const query = (sql) => queryInterface.sequelize.query(sql);

    // These foreign keys reference tenants.id (and, transitively, users.tenantId),
    // both of which are about to change shape. They're re-created against the
    // new integer columns by the two migrations that follow this one.
    await query('ALTER TABLE bookings DROP FOREIGN KEY bookings_tenant_fk');
    await query('ALTER TABLE users DROP FOREIGN KEY users_tenant_fk');
    await query('ALTER TABLE bookings DROP FOREIGN KEY bookings_user_tenant_fk');

    // Preserve every existing tenant identifier ('psg', 'vit', 'default-tenant', ...)
    // as `slug`, then introduce a fresh auto-increment integer primary key.
    await query('ALTER TABLE tenants CHANGE id slug VARCHAR(36) NOT NULL');
    await query('ALTER TABLE tenants DROP PRIMARY KEY');
    await query('ALTER TABLE tenants ADD UNIQUE KEY tenants_slug_unique (slug)');
    await query('ALTER TABLE tenants ADD COLUMN id INT NOT NULL AUTO_INCREMENT PRIMARY KEY FIRST');
  },

  async down(queryInterface) {
    const query = (sql) => queryInterface.sequelize.query(sql);

    await query('ALTER TABLE tenants DROP PRIMARY KEY');
    await query('ALTER TABLE tenants DROP COLUMN id');
    await query('ALTER TABLE tenants DROP INDEX tenants_slug_unique');
    await query('ALTER TABLE tenants CHANGE slug id VARCHAR(36) NOT NULL');
    await query('ALTER TABLE tenants ADD PRIMARY KEY (id)');

    // Restore the original string-keyed foreign keys now that every column
    // involved (tenants.id, users.tenantId, bookings.tenantId) is back to
    // VARCHAR(36) at this point in the rollback.
    await query(`
      ALTER TABLE users ADD CONSTRAINT users_tenant_fk
      FOREIGN KEY (tenantId) REFERENCES tenants(id)
      ON UPDATE CASCADE ON DELETE RESTRICT
    `);
    await query(`
      ALTER TABLE bookings ADD CONSTRAINT bookings_tenant_fk
      FOREIGN KEY (tenantId) REFERENCES tenants(id)
      ON UPDATE CASCADE ON DELETE RESTRICT
    `);
    await query(`
      ALTER TABLE bookings ADD CONSTRAINT bookings_user_tenant_fk
      FOREIGN KEY (userId, tenantId) REFERENCES users(id, tenantId)
      ON UPDATE CASCADE ON DELETE RESTRICT
    `);
  }
};
