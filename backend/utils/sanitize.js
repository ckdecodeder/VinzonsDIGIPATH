const stripPassword = (user) => {
  if (!user) return user;
  const safeUser = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  delete safeUser.password;
  return safeUser;
};

module.exports = {
  stripPassword,
};
