import { DataTypes, Model } from 'sequelize';
import sequelize from '../db/sequelize.js';
import Tenant from './Tenant.js';

class User extends Model {}

User.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  tenantId: { type: DataTypes.INTEGER, allowNull: false },
  fullName: { type: DataTypes.STRING(150), allowNull: false, validate: { notEmpty: true, len: [1, 150] } },
  email: { type: DataTypes.STRING(255), allowNull: false, validate: { isEmail: true, len: [3, 255] } },
  passwordHash: { type: DataTypes.STRING(255), allowNull: false, validate: { notEmpty: true } },
  role: { type: DataTypes.ENUM('admin', 'student', 'staff'), allowNull: false, defaultValue: 'student' },
  status: { type: DataTypes.ENUM('active', 'inactive', 'pending'), allowNull: false, defaultValue: 'active' },
  lastLoginAt: { type: DataTypes.DATE, allowNull: true },
  deletedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  sequelize,
  modelName: 'User',
  tableName: 'users',
  timestamps: true,
  paranoid: false,
  indexes: [
    { unique: true, fields: ['tenantId', 'email'] },
    { fields: ['tenantId'] }
  ]
});

Tenant.hasMany(User, { foreignKey: 'tenantId', as: 'users' });
User.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

export default User;