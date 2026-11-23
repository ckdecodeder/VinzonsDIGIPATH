import { isDocumentVisibleToUser, isTransmissionVisibleToUser } from './documentScope.js';

export const dismissalKey = userId => `dp_dismissedNotifications:${userId}`;

export function readDismissals(storage, userId) {
  try {
    const ids = JSON.parse(storage.getItem(dismissalKey(userId)));
    return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export async function resolveNotificationTarget(item, user, sentDocumentIds, readDelivery, readDocument) {
  let delivery;
  if (item.referenceType === 'transmission' || item.page === 'transmissions' && !item.referenceType) {
    if (!item.referenceId) throw new Error('This alert has no delivery reference.');
    delivery = await readDelivery(item.referenceId);
    if (delivery?.id !== item.referenceId || !isTransmissionVisibleToUser(delivery, user)) {
      throw new Error('This delivery is unavailable to your account.');
    }
  } else if (item.referenceType !== 'document') {
    return null;
  }
  const id = delivery?.documentId || item.referenceId;
  if (!id) throw new Error('This alert has no document reference.');
  const document = await readDocument(id);
  const sent = new Set(sentDocumentIds);
  if (delivery?.fromOfficeId === user.officeId) sent.add(id);
  if (document?.id !== id || !isDocumentVisibleToUser(document, user, { sentDocumentIds: sent })) {
    throw new Error('This document is unavailable to your account.');
  }
  return { document, delivery };
}

export const pendingOfficeReceipt = (doc, deliveries, officeId, target) => deliveries.find(item =>
  officeId && item.documentId === doc.id && item.toOfficeId === officeId && !item.receivedBy
  && (!target || target.documentId !== doc.id || item.id === target.id));
