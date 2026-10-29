// Synthetic fixtures only; refuse populated or non-test databases.
require('dotenv').config({ quiet: true });
const { requireTestWrite } = require('../utils/maintenanceGuard');
const main = async () => {
  requireTestWrite(process.env.DATABASE_URL, process.argv);
  if (!process.env.SEED_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD.length < 12) throw new Error('Set a synthetic SEED_ADMIN_PASSWORD of at least 12 characters.');
  const { sequelize, connectDB } = require('../config/db');
  const { syncModels, _sequelizeModels: models } = require('../models');
  try {
    await connectDB(); await sequelize.authenticate(); await syncModels();
    const counts = await Promise.all(Object.values(models).map(model => model.count()));
    if (counts.some(Boolean)) throw new Error('Seed requires an empty disposable test database. Existing records were preserved.');
    const fixture = require('../data/seedData');
    const password = await require('bcryptjs').hash(process.env.SEED_ADMIN_PASSWORD, 10);
    await sequelize.transaction(async transaction => {
      for (const [name, rows] of [['OfficeModel', fixture.offices], ['DocumentTypeModel', fixture.documentTypes], ['UserModel', fixture.users.map(user => ({ ...user, password }))], ['DocumentModel', fixture.documents], ['TransmissionModel', fixture.transmissions], ['ArchiveModel', fixture.archives], ['LogModel', fixture.logs], ['DeviceModel', [fixture.device]]]) {
        if (rows?.length) await models[name].bulkCreate(rows, { transaction });
      }
    });
    console.log('Synthetic test fixtures created.');
  } finally { if (sequelize) await sequelize.close(); }
};
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
