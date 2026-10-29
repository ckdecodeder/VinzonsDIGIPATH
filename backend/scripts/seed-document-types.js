require('dotenv').config({ quiet: true });
require('../utils/maintenanceGuard').requireTestWrite(process.env.DATABASE_URL, process.argv);
const { connectDB } = require('../config/db');
const { syncModels, DocumentType } = require('../models');

const types = [
  { id: 'DT-001', category: 'Memorandum' },
  { id: 'DT-002', category: 'Executive Order' },
  { id: 'DT-003', category: 'Communication Letter' },
  { id: 'DT-004', category: 'Proposal' },
  { id: 'DT-005', category: 'Resolution' },
  { id: 'DT-006', category: 'Ordinance' },
  { id: 'DT-007', category: 'Report' },
  { id: 'DT-008', category: 'Request' },
  { id: 'DT-009', category: 'Others' },
];

async function run() {
  await connectDB();

  const { sequelize } = require('../config/db');

  // Ensure category column exists (migration safety)
  await sequelize.query(`
    ALTER TABLE document_types
    ADD COLUMN IF NOT EXISTS category VARCHAR(255);
  `);

  // Drop old 'name' column if it exists and category is now the right one
  await sequelize.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='document_types' AND column_name='name') THEN
        UPDATE document_types SET category = name WHERE category IS NULL;
        ALTER TABLE document_types DROP COLUMN IF EXISTS name;
      END IF;
    END$$;
  `);

  await syncModels();

  for (const t of types) {
    await DocumentType.updateOne({ id: t.id }, { $set: t }, { upsert: true });
  }

  const all = await DocumentType.find();
  console.log('Document types seeded:', all.map(x => `${x.id} - ${x.category}`).join('\n'));
  process.exit(0);
}

run().catch(e => { console.error(e.message); process.exit(1); });
