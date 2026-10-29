const weakSecret = value => typeof value !== 'string' || value.length < 32 || /^(dev-only|dev-device|change_this|replace_with)/i.test(value);
const validateRuntimeConfig = (env = process.env) => {
  const missing = [];
  if (weakSecret(env.JWT_SECRET)) missing.push('JWT_SECRET');
  if (weakSecret(env.DEVICE_API_KEY)) missing.push('DEVICE_API_KEY');
  if (missing.length) throw new Error(`Configure strong values of at least 32 characters for: ${missing.join(', ')}. Prepare coordinated backend/Pi configuration before restarting.`);
  if (!env.DATABASE_URL || !/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL)) throw new Error('A PostgreSQL DATABASE_URL is required.');
};
module.exports = { validateRuntimeConfig, weakSecret };
