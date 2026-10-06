const TECHNICAL_PATTERNS = [
  /groq/i,
  /digipath_groq/i,
  /api\.groq/i,
  /network\.env/i,
  /openai\/v1\/chat/i,
  /traceback/i,
  /<html/i,
];

function toUserFacingError(message, fallback = 'Something went wrong. Please try again.') {
  const text = String(message || '').trim();
  if (!text) return '';

  const lower = text.toLowerCase();

  if (TECHNICAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'Auto-fill did not finish. You can enter the document details manually.';
  }

  if (/no preview frame|wait for live stream/.test(lower)) {
    return 'Camera preview is not ready yet. Wait for the live view, then capture again.';
  }

  if (/lift\/hall|mechanism|hall prep/.test(lower)) {
    return 'Scanner mechanism error. Check motors and sensors, then try again.';
  }

  if (/timeout|timed out/.test(lower)) {
    return 'The scanner took too long to respond. Please try again.';
  }

  if (/econnrefused|could not reach|fetch failed/i.test(text)) {
    return 'Could not reach the server. Check the network and try again.';
  }

  if (text.length > 180 || /http:\/\//i.test(text)) {
    return fallback;
  }

  return text;
}

module.exports = {
  toUserFacingError,
};
