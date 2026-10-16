import { DataTypes, Model } from 'sequelize';
import sequelize from '../db/sequelize.js';

class Tenant extends Model {}

Tenant.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  slug: { type: DataTypes.STRING(36), allowNull: false, unique: true, validate: { notEmpty: true } },
  name: { type: DataTypes.STRING(150), allowNull: false, validate: { notEmpty: true, len: [1, 150] } }
}, {
  sequelize,
  modelName: 'Tenant',
  tableName: 'tenants',
  timestamps: true
});

export default Tenant;
