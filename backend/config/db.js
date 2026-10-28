const { Sequelize } = require('sequelize');

let sequelizeInstance = null;
let _isConnected = false;

if (process.env.DATABASE_URL) {
  sequelizeInstance = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
  });
}

const connectDB = async () => {
  if (!sequelizeInstance) {
    console.warn('DATABASE_URL is not set. API data routes will return 503 until a database is configured.');
    return null;
  }

  try {
    await sequelizeInstance.authenticate();
    _isConnected = true;
    console.log('Connected to PostgreSQL via Sequelize');
    return sequelizeInstance;
  } catch (err) {
    _isConnected = false;
    console.error('Failed to connect to PostgreSQL', err);
    return null;
  }
};

const getDatabaseStatus = () => (_isConnected ? 'connected' : 'disconnected');
const checkDatabaseReadiness = async () => {
  if (!sequelizeInstance) return false;
  try { await sequelizeInstance.authenticate(); _isConnected = true; }
  catch { _isConnected = false; }
  return _isConnected;
};

module.exports = {
  sequelize: sequelizeInstance,
  connectDB,
  getDatabaseStatus,
  checkDatabaseReadiness,
};
