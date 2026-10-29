// Schema migration only: no historical export import, force sync, or reseeding.
require('dotenv').config({ quiet: true });
const { requireMaintenanceWrite } = require('../utils/maintenanceGuard');
const main = async () => {
  requireMaintenanceWrite(process.env.DATABASE_URL, process.argv);
  const { sequelize, connectDB } = require('../config/db');
  try {
    await connectDB();
    await sequelize.authenticate();
    await require('../models').syncModels();
    console.log('Schema migration completed. Business records were not imported or reseeded.');
  } finally { if (sequelize) await sequelize.close(); }
};
if (require.main === module) main().catch(() => { console.error('Migration failed. Verify target, --apply, and required backup before retrying.'); process.exitCode = 1; });
module.exports = { main };
