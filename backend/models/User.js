const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true, select: false },
  fname: { type: String, required: true },
  lname: { type: String, required: true },
  mname: { type: String },
  role: { type: String, enum: ['Admin', 'Mayor', 'Receptionist', 'Office'], default: 'Receptionist' },
  officeId: { type: String }, // References office.id manually
});

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.pre('findOneAndUpdate', async function hashUpdatedPassword() {
  const update = this.getUpdate();
  if (!update) return;

  const password = update.password || update.$set?.password;
  if (!password || password.startsWith('$2')) return;

  const hashed = await bcrypt.hash(password, 10);
  if (update.$set?.password) {
    update.$set.password = hashed;
  } else {
    update.password = hashed;
  }
  this.setUpdate(update);
});

userSchema.methods.matchPassword = function matchPassword(password) {
  return bcrypt.compare(password, this.password);
};

userSchema.methods.toSafeObject = function toSafeObject() {
  const user = this.toObject();
  delete user.password;
  return user;
};

const User = mongoose.model('User', userSchema);
module.exports = User;
