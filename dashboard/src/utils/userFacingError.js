/**
 * Convert internal/technical errors into short messages safe for end users.
 */
export function toUserFacingError(message, fallback = 'Something went wrong. Please try again.') {
  const text = String(message || '').trim();
  if (!text) return fallback;

  const lower = text.toLowerCase();

  if (
    /groq|digipath_groq|api\.groq|network\.env|npm run network:sync|openai\/v1\/chat/.test(lower)
  ) {
    return 'Auto-fill did not finish. You can enter the document details manually.';
  }

  if (/no preview frame|wait for live stream/.test(lower)) {
    return 'Camera preview is not ready yet. Wait for the live view, then capture again.';
  }

  if (/pending command/.test(lower)) {
    return 'The scanner is still busy with a previous scan. Cancel it or wait a moment, then try again.';
  }

  if (/timeout|timed out/.test(lower)) {
    return 'The scanner took too long to respond. Please try again.';
  }

  if (/lift\/hall|mechanism|hall prep/.test(lower)) {
    return 'Scanner mechanism error. Check motors and sensors, then try again.';
  }

  if (/econnrefused|network|fetch failed|could not reach/.test(lower)) {
    return 'Could not reach the server. Check the network and try again.';
  }

  if (
    text.length > 180
    || /traceback|exception|errno|http:\/\//i.test(text)
    || /<html/i.test(text)
  ) {
    return fallback;
  }

  return text;
}
