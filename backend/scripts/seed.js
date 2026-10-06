require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const {
  Office,
  User,
  DocumentType,
  Document,
  Transmission,
  Archive,
  Device,
  Log,
} = require('../models');
const seedData = require('../data/seedData');

const upsertMany = async (Model, records) => {
  for (const record of records) {
    await Model.updateOne(
      { id: record.id },
      { $set: record },
      { upsert: true, runValidators: true }
    );
  }
};

const hashSeedUsers = async (users) => {
  return Promise.all(users.map(async (user) => ({
    ...user,
    password: user.password.startsWith('$2') ? user.password : await bcrypt.hash(user.password, 10),
  })));
};

const reseedUsers = async (users) => {
  const ids = users.map((user) => user.id);
  const usernames = users.map((user) => user.username);

  await User.deleteMany({
    $or: [
      { id: { $in: ids } },
      { username: { $in: usernames } },
    ],
  });

  if (users.length) {
    await User.insertMany(users, { ordered: true });
  }
};

const seed = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set. Add it to backend/.env before seeding.');
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });

  const users = await hashSeedUsers(seedData.users);

  await upsertMany(Office, seedData.offices);
  await upsertMany(DocumentType, seedData.documentTypes);
  await reseedUsers(users);
  await upsertMany(Document, seedData.documents);
  await upsertMany(Transmission, seedData.transmissions);
  await upsertMany(Archive, seedData.archives);
  await upsertMany(Log, seedData.logs);
  await Device.updateOne(
    { id: seedData.device.id },
    { $set: seedData.device },
    { upsert: true, runValidators: true }
  );

  console.log('Database seeded successfully.');
};

seed()
  .catch((err) => {
    console.error('Database seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
