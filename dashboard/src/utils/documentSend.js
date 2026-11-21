export const getSendRecipients = (custodyOfficeId, copyOfficeIds, currentOfficeId, offices) => {
  if (!custodyOfficeId) throw new Error('Choose a custody office before sending.');
  const recipients = [...new Set([custodyOfficeId, ...copyOfficeIds].filter(Boolean))];
  if (recipients.includes(currentOfficeId)) throw new Error('Cannot send a document to its current office.');
  if (recipients.some(id => !offices.some(office => office.id === id))) {
    throw new Error('Choose an available office for custody and each copy.');
  }
  return recipients;
};

export const confirmsDocumentSend = (before, current, destinations, userId) => {
  if (!current || current.id !== before.id) return false;
  const previousIds = new Set((before.sendHistory || []).map(event => event.id || event.transmissionId));
  const groups = new Map();
  for (const event of current.sendHistory || []) {
    if (!event.deliveryGroupId || previousIds.has(event.id || event.transmissionId)
      || event.fromOfficeId !== before.currentOfficeId || event.sentBy !== userId) continue;
    if (!groups.has(event.deliveryGroupId)) groups.set(event.deliveryGroupId, []);
    groups.get(event.deliveryGroupId).push(event);
  }
  return [...groups.values()].some(events => events.length === destinations.length
    && events.filter(event => event.primary).length === 1
    && events.find(event => event.primary)?.toOfficeId === destinations[0]
    && destinations.every(id => events.some(event => event.toOfficeId === id)));
};

export const sendDocumentWithRecovery = async ({ document, destinations, userId, send, read }) => {
  try {
    const saved = await send(document.id, destinations);
    if (saved?.id === document.id) return { status: 'sent', document: saved };
  } catch (error) {
    const definiteFailure = error.code === 'API_UNAVAILABLE'
      || (error.code === 'HTTP_ERROR' && error.status >= 400 && error.status < 500 && error.status !== 408);
    if (definiteFailure) throw error;
  }
  try {
    const current = await read(document.id);
    if (confirmsDocumentSend(document, current, destinations, userId)) return { status: 'sent', document: current, reconciled: true };
  } catch {
    // A failed or unchanged read cannot prove an earlier timed-out write was rejected.
  }
  return { status: 'unknown' };
};
