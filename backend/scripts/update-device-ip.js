require('dotenv').config({ quiet: true });
const { connectDB } = require('../config/db');
const { syncModels, Device } = require('../models');

async function run() {
  await connectDB();
  await syncModels();

  const device = await Device.findOneAndUpdate(
    { id: 'DEV-001' },
    {
      $set: {
        ip: '192.168.254.132',
        status: 'Online',
        location: 'Reception Area',
        name: 'Physical Document Scanner',
      },
    },
    { upsert: true, new: true },
  );

  console.log('Device updated:', {
    id: device?.id,
    ip: device?.ip,
    status: device?.status,
  });
  process.exit(0);
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
