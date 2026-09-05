import { DataTypes, Model } from 'sequelize';
import sequelize from '../db/sequelize.js';
import User from './User.js';

class Booking extends Model {}

Booking.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  tenantId: { type: DataTypes.STRING(36), allowNull: false, validate: { notEmpty: true } },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  eventName: { type: DataTypes.STRING(150), allowNull: false, validate: { notEmpty: true } },
  status: {
    type: DataTypes.ENUM('pending', 'confirmed', 'cancelled'),
    allowNull: false,
    defaultValue: 'pending',
    validate: { isIn: [['pending', 'confirmed', 'cancelled']] }
  },
  bookingDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  notes: { type: DataTypes.TEXT, allowNull: true },
  totalAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  deletedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  sequelize,
  modelName: 'Booking',
  tableName: 'bookings',
  timestamps: true,
  indexes: [{ fields: ['tenantId'] }, { unique: true, fields: ['tenantId', 'userId', 'eventName'] }]
});

User.hasMany(Booking, { foreignKey: 'userId', as: 'bookings' });
Booking.belongsTo(User, { foreignKey: 'userId', as: 'user' });

export default Booking;