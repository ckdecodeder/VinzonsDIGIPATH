const { normalizeText } = require('./helpers');

const rateLimitBuckets = new Map();

const createRateLimiter = ({ windowMs, max, keyPrefix }) => (req, res, next) => {
  const now = Date.now();
  const key = `${keyPrefix}:${req.ip}:${normalizeText(req.body?.username || req.params?.trackingNumber || req.body?.deviceId || '')}`;
  const bucket = rateLimitBuckets.get(key) || { count: 0, resetAt: now + windowMs };

  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }

  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  if (bucket.count > max) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ message: 'Too many requests. Please wait before trying again.' });
  }

  if (rateLimitBuckets.size > 5000) {
    for (const [bucketKey, item] of rateLimitBuckets.entries()) {
      if (now > item.resetAt) rateLimitBuckets.delete(bucketKey);
    }
  }

  next();
};

const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: 'login' });
const trackingLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 80, keyPrefix: 'tracking' });
const deviceLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 300, keyPrefix: 'device' });

module.exports = { createRateLimiter, loginLimiter, trackingLimiter, deviceLimiter };
