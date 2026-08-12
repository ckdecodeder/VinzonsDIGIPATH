/** Canonical public API URL (tunnel / cloud). Used by /api/config and client auto-connect. */
function getPublicApiUrl(req) {
  const fromEnv = process.env.PUBLIC_API_URL?.trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;

  if (req) {
    const host = req.get('x-forwarded-host') || req.get('host');
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0]?.trim();
    if (host) return `${proto}://${host}`.replace(/\/$/, '');
  }

  const port = process.env.PORT || 5000;
  return `http://127.0.0.1:${port}`;
}

module.exports = {
  getPublicApiUrl,
};
