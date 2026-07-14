/**
 * Reset/ensure known demo logins in Postgres.
 * Usage: node backend/scripts/set-demo-passwords.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

// Explicit overrides; everyone else falls back to `${username}123`.
const DEMO_PASSWORDS = {
  admin: 'admin123',
  mayor: 'mayor123',
  mayor2: 'admin789',
  mayor3: 'admin101',
  mayor4: 'admin202',
  receptionist: 'recep123',
  receptionist2: 'recep456',
  receptionist3: 'recep789',
  janeromarco: 'office123',
  simon: 'simon123',
  unc: 'unc123',
  sean: 'sean123',
};

const EXTRA_USERS = [
  {
    id: 'USR-SIMON-001',
    username: 'simon',
    password: 'simon123',
    fname: 'Simon',
    lname: 'Unc',
    mname: '',
    role: 'Office',
    officeId: 'OFF-001',
    contact: null,
    email: null,
  },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const { rows: existing } = await client.query(
    'SELECT id, username, role, fname, lname, "officeId" FROM users ORDER BY username'
  );

  console.log('Current users:', existing.length);

  for (const user of existing) {
    const plain = DEMO_PASSWORDS[user.username] || `${user.username}123`;
    const hash = await bcrypt.hash(plain, 10);
    await client.query('UPDATE users SET password = $1 WHERE id = $2', [hash, user.id]);
    console.log(`  ${user.username.padEnd(16)} ${user.role.padEnd(14)} -> ${plain}`);
  }

  for (const extra of EXTRA_USERS) {
    const found = existing.find((u) => u.username === extra.username);
    if (found) {
      console.log(`  skip create ${extra.username} (already exists)`);
      continue;
    }
    const hash = await bcrypt.hash(extra.password, 10);
    await client.query(
      `INSERT INTO users (id, username, password, fname, lname, mname, role, "officeId", contact, email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        extra.id,
        extra.username,
        hash,
        extra.fname,
        extra.lname,
        extra.mname || null,
        extra.role,
        extra.officeId,
        extra.contact,
        extra.email,
      ]
    );
    console.log(`  CREATED ${extra.username.padEnd(16)} ${extra.role.padEnd(14)} -> ${extra.password}`);
  }

  console.log('\nDone. Demo passwords applied.');
  await client.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
