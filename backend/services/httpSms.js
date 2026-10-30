const { normalizeSmsNumber } = require('../utils/sms');
const ORIGIN = 'https://api.httpsms.com/v1';
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const states = { pending: 'Accepted', scheduled: 'Accepted', sending: 'Accepted', sent: 'Sent', delivered: 'Delivered', failed: 'Failed', expired: 'Expired', deleted: 'Unknown' };
const getSmsConfig = (env = process.env) => {
  const enabled = env.SMS_ENABLED === 'true';
  const apiKey = String(env.HTTPSMS_API_KEY || '').trim();
  let from = '';
  try { from = normalizeSmsNumber(env.HTTPSMS_FROM_NUMBER); } catch { /* Missing settings leave the outbox paused. */ }
  const sim = env.HTTPSMS_SIM || 'SIM2';
  const timeout = Number(env.HTTPSMS_TIMEOUT_MS || 10000);
  const minInterval = Number(env.HTTPSMS_MIN_INTERVAL_MS || 6000);
  const ready = enabled && !!apiKey && !/[\r\n]/.test(apiKey) && !!from && ['SIM1', 'SIM2'].includes(sim);
  return { enabled, ready, apiKey, from, sim,
    minIntervalMs: Number.isFinite(minInterval) ? Math.max(1000, Math.min(minInterval, 60000)) : 6000,
    timeoutMs: Number.isFinite(timeout) ? Math.max(1000, Math.min(timeout, 30000)) : 10000 };
};
class SmsProviderError extends Error {
  constructor(message, retryable = false) { super(message); this.name = 'SmsProviderError'; this.retryable = retryable; }
}
const createHttpSmsClient = ({ fetch: fetcher = global.fetch } = {}) => {
  const request = async (path, config, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      response = await fetcher(`${ORIGIN}${path}`, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: controller.signal,
        headers: { 'x-api-key': config.apiKey, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        const safeRejection = [400, 401, 402, 403, 404, 422, 429].includes(response.status);
        throw new SmsProviderError(`httpSMS rejected the request (HTTP ${response.status}).`, safeRejection);
      }
      if (!response.headers.get('content-type')?.includes('application/json')) throw new SmsProviderError('httpSMS returned an invalid response; delivery is unconfirmed.');
      const reader = response.body.getReader();
      const chunks = []; let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 65536) throw new SmsProviderError('httpSMS response exceeded the safe limit; delivery is unconfirmed.');
        chunks.push(Buffer.from(value));
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (result.status !== 'success' || result.data === undefined) throw new SmsProviderError('httpSMS returned an invalid response; delivery is unconfirmed.');
      return result.data;
    } catch (error) {
      if (error instanceof SmsProviderError) throw error;
      throw new SmsProviderError(controller.signal.aborted
        ? 'httpSMS timed out; delivery is unconfirmed. Check status before retrying.'
        : 'httpSMS could not confirm the request. Check status before retrying.');
    } finally {
      clearTimeout(timer);
      controller.abort();
      // Never persist/log provider bodies, tokens, phone listings, or failure_reason.
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    }
  };
  const messageResult = (message, notification, config) => {
    if (!message || !uuid.test(message.id || '') || !states[message.status]
      || message.owner !== config.from || message.contact !== notification.recipient
      || message.request_id !== notification.requestId || message.sim !== config.sim) {
      throw new SmsProviderError('httpSMS response did not match this SMS or SIM; delivery is unconfirmed.');
    }
    return { providerMessageId: message.id, status: states[message.status],
      sentAt: ['Sent', 'Delivered'].includes(states[message.status]) ? message.sent_at || null : null,
      deliveredAt: states[message.status] === 'Delivered' ? message.delivered_at || null : null,
      errorMessage: ['failed', 'expired'].includes(message.status) ? 'The phone reported a sending failure or expiry. Review the message in httpSMS.' : '' };
  };
  return {
    async send(notification, config) {
      if (!config.ready) throw new SmsProviderError('SMS delivery is not configured.', true);
      // Verify server-side registration before POST; SIM choice is tied to the sender phone.
      try {
        const phones = await request('/phones', config);
        const matches = Array.isArray(phones) ? phones.filter(phone => phone.phone_number === config.from) : [];
        if (matches.length !== 1 || matches[0].sim !== config.sim) throw new SmsProviderError('The httpSMS sender/SIM registration does not match the configured phone.', true);
        if (matches[0].max_send_attempts !== 1) throw new SmsProviderError('Set the httpSMS phone maximum send attempts to 1 before enabling DigiPath.', true);
        const rate = Number(matches[0].messages_per_minute);
        if (Number.isFinite(rate) && rate > 0 && (config.minIntervalMs ?? 6000) < Math.ceil(60000 / rate)) {
          throw new SmsProviderError('Increase HTTPSMS_MIN_INTERVAL_MS to match the registered phone message rate before sending.', true);
        }
      } catch (error) {
        // No POST was made, so a later manual retry is safe.
        throw new SmsProviderError(error instanceof SmsProviderError ? error.message : 'Cannot verify the httpSMS phone.', true);
      }
      const result = await request('/messages/send', config, {
        from: config.from, to: notification.recipient, content: notification.message, request_id: notification.requestId,
      });
      return messageResult(result, notification, config);
    },
    async reconcile(notification, config) {
      if (notification.providerMessageId) {
        return messageResult(await request(`/messages/${notification.providerMessageId}`, config), notification, config);
      }
      // request_id is correlation ONLY. Scan a bounded conversation window, never resubmit.
      const params = new URLSearchParams({ owner: config.from, contact: notification.recipient, limit: '20', skip: '0' });
      const messages = await request(`/messages?${params}`, config);
      if (!Array.isArray(messages)) throw new SmsProviderError('httpSMS returned an invalid message list.');
      const matches = messages.filter(message => message.request_id === notification.requestId);
      if (matches.length !== 1) return null;
      return messageResult(matches[0], notification, config);
    },
  };
};
module.exports = { getSmsConfig, createHttpSmsClient, SmsProviderError };
