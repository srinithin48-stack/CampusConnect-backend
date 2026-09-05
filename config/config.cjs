require('dotenv').config();

const database = {
  database: process.env.DB_NAME || 'campusconnect',
  username: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  dialect: 'mysql',
  logging: false
};

module.exports = {
  development: database,
  test: { ...database, database: process.env.DB_TEST_NAME || 'campusconnect_test' },
  production: database
};