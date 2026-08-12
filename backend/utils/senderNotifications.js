const { normalizeText, generateId } = require('./helpers');

// ─── Sender Notification Channels ─────────────────────────────────────────────
const senderChannels = ['sms', 'email'];

const normalizeSenderNotificationChannels = (channels, source = {}) => {
  const hasExplicitChannels = Array.isArray(channels) || typeof channels === 'string';
  const requested = Array.isArray(channels)
    ? channels
    : (typeof channels === 'string' ? [channels] : []);
  const validRequested = [...new Set(requested.map(normalizeText).filter(channel => senderChannels.includes(channel)))];
  if (validRequested.length) return validRequested;
  if (hasExplicitChannels) return [];

  return [
    ...(source.senderContact ? ['sms'] : []),
    ...(source.senderEmail ? ['email'] : []),
  ];
};

// ─── Tracking URL ──────────────────────────────────────────────────────────────
const getPublicTrackingUrl = (req, trackingNumber) => {
  const baseUrl = (
    process.env.PUBLIC_TRACKING_BASE_URL ||
    req.get?.('origin') ||
    'http://localhost:5173'
  ).replace(/\/$/, '');
  return `${baseUrl}/?tracking=${encodeURIComponent(trackingNumber || '')}`;
};

// ─── Message Builders ──────────────────────────────────────────────────────────
const senderEventLabels = {
  document_received: 'Document received',
  document_scanned: 'Document scanned',
  document_approved: 'Document approved',
  document_rejected: 'Document rejected',
  document_resubmitted: 'Document resubmitted',
  document_routed: 'Document routed',
  document_for_signing: 'Document for signing',
  document_for_signature: 'Document for signing',
  document_for_filing: 'Document for filing',
  document_signed: 'Document signed',
  document_acknowledged: 'Document acknowledged',
  transmission_received: 'Document received by office',
  action_note: 'Document action note',
  ready_for_signing: 'Document for signing',
  ready_for_signature: 'Document for signing',
  ready_for_filing: 'Document for filing',
  sign_document: 'Document signed',
  acknowledge_document: 'Document acknowledged',
  document_archived: 'Document archived',
};

const buildSenderNotificationContent = (req, doc, eventType, context = {}, channel = 'sms') => {
  const trackingUrl = getPublicTrackingUrl(req, doc.trackingNumber);
  const title = context.title || senderEventLabels[eventType] || 'Document update';
  const detail = context.message || `${doc.subject} has a new update.`;

  if (channel === 'email') {
    return {
      subject: `DigiPath update: ${doc.trackingNumber}`,
      message: [
        `Hello ${doc.senderName || 'Sender'},`,
        '',
        detail,
        '',
        `Tracking number: ${doc.trackingNumber}`,
        `Subject: ${doc.subject}`,
        `Track online: ${trackingUrl}`,
        '',
        'This is an automated DigiPath sender update.',
      ].join('\n'),
    };
  }

  return {
    subject: title,
    message: `DigiPath ${doc.trackingNumber}: ${detail} Track: ${trackingUrl}`,
  };
};

// ─── Delivery Providers ────────────────────────────────────────────────────────
const sendTwilioSms = async (notification) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error('Twilio SMS is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER.');
  }

  const body = new URLSearchParams({
    To: notification.recipient,
    From: fromNumber,
    Body: notification.message,
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const resultText = await response.text();
  if (!response.ok) {
    throw new Error(`Twilio SMS failed (${response.status}): ${resultText}`);
  }
};

const sendSendGridEmail = async (notification) => {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || process.env.SENDGRID_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    throw new Error('SendGrid email is not configured. Set SENDGRID_API_KEY and EMAIL_FROM.');
  }

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: notification.recipient, name: notification.recipientName || undefined }] }],
      from: { email: fromEmail, name: process.env.EMAIL_FROM_NAME || 'Vinzons DigiPath' },
      subject: notification.subject || 'DigiPath document update',
      content: [{ type: 'text/plain', value: notification.message }],
    }),
  });
  const resultText = await response.text();
  if (!response.ok) {
    throw new Error(`SendGrid email failed (${response.status}): ${resultText}`);
  }
};

const sendResendEmail = async (notification) => {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    throw new Error('Resend email is not configured. Set RESEND_API_KEY and EMAIL_FROM.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [notification.recipient],
      subject: notification.subject || 'DigiPath document update',
      text: notification.message,
    }),
  });
  const resultText = await response.text();
  if (!response.ok) {
    throw new Error(`Resend email failed (${response.status}): ${resultText}`);
  }
};

const sendNotificationWebhook = async (notification) => {
  const url = process.env.SENDER_NOTIFICATION_WEBHOOK_URL;
  if (!url) {
    throw new Error('Sender notification webhook is not configured.');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.SENDER_NOTIFICATION_WEBHOOK_TOKEN
        ? { Authorization: `Bearer ${process.env.SENDER_NOTIFICATION_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(notification.toObject ? notification.toObject() : notification),
  });
  const resultText = await response.text();
  if (!response.ok) {
    throw new Error(`Notification webhook failed (${response.status}): ${resultText}`);
  }
};

const updateSenderDelivery = async (notification, updates) => {
  const { SenderNotification } = require('../models');
  return SenderNotification.findOneAndUpdate(
    { id: notification.id },
    { $set: updates },
    { new: true, runValidators: true },
  );
};

const deliverSenderNotification = async (notification) => {
  const provider = (process.env.SENDER_NOTIFICATION_PROVIDER || 'outbox').toLowerCase();
  if (provider === 'outbox') return notification;

  try {
    if (notification.channel === 'sms' && (provider.includes('twilio') || provider === 'auto')) {
      await sendTwilioSms(notification);
    } else if (notification.channel === 'email' && (provider.includes('sendgrid') || provider === 'auto')) {
      await sendSendGridEmail(notification);
    } else if (notification.channel === 'email' && provider.includes('resend')) {
      await sendResendEmail(notification);
    } else if (provider.includes('webhook')) {
      await sendNotificationWebhook(notification);
    } else {
      throw new Error(`No sender delivery provider configured for ${notification.channel}.`);
    }

    return updateSenderDelivery(notification, {
      status: 'Sent',
      error: '',
      errorMessage: '',
      sentAt: new Date().toISOString(),
    });
  } catch (err) {
    return updateSenderDelivery(notification, {
      status: 'Failed',
      error: err.message,
      errorMessage: err.message,
      sentAt: '',
    });
  }
};

const queueSenderNotifications = async (req, rawDoc, eventType, context = {}) => {
  try {
    const { SenderNotification } = require('../models');
    const doc = rawDoc?.toObject ? rawDoc.toObject() : rawDoc;
    if (!doc?.id || doc.notifySender === false || doc.senderNotificationConsent === false) return [];

    const channels = normalizeSenderNotificationChannels(doc.senderNotificationChannels, doc)
      .filter((channel) => channel !== 'email'); // Outsider email notifications removed
    const recipients = {
      sms: normalizeText(doc.senderContact),
      email: '',
    };
    const now = new Date().toISOString();
    const provider = process.env.SENDER_NOTIFICATION_PROVIDER || 'outbox';
    const created = [];

    for (const channel of channels) {
      const recipient = recipients[channel];
      if (!recipient) continue;
      const content = buildSenderNotificationContent(req, doc, eventType, context, channel);
      const senderNotification = new SenderNotification({
        id: generateId('SNOTIF'),
        documentId: doc.id,
        trackingNumber: doc.trackingNumber,
        eventType,
        channel,
        recipient,
        recipientName: doc.senderName,
        subject: content.subject,
        message: content.message,
        status: 'Queued',
        provider,
        error: '',
        errorMessage: '',
        createdAt: now,
        createdBy: req.user?.id || 'system',
        metadata: {
          ...(context.metadata || {}),
          outboxMode: provider === 'outbox',
        },
      });
      await senderNotification.save();
      const delivered = await deliverSenderNotification(senderNotification);
      created.push(delivered || senderNotification);
    }

    return created;
  } catch (err) {
    console.error('queueSenderNotifications failed (non-fatal):', err.message);
    return [];
  }
};

module.exports = {
  senderChannels,
  normalizeSenderNotificationChannels,
  getPublicTrackingUrl,
  buildSenderNotificationContent,
  sendTwilioSms,
  sendSendGridEmail,
  sendResendEmail,
  sendNotificationWebhook,
  deliverSenderNotification,
  queueSenderNotifications,
};
