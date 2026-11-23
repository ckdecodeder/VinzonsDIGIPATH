const { createHttpError } = require('./helpers');
const { snapshotGuard } = require('./workflowGuard');

// The timeline lives on the document row. The same locked validation that checks
// custody also rejects a concurrent replay before it can append a second event.
function workflowOperation(req, doc, action) {
  const id = req.body.operationId;
  if (id !== undefined && (typeof id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(id))) {
    throw createHttpError('Invalid document action reference.', 400);
  }
  const recorded = current => Boolean(id && (current.timeline || []).some(event =>
    event.operationId === id && event.userId === req.user.id && event.action === action));
  const guard = snapshotGuard(req, doc, { custody: true });
  return {
    recorded: recorded(doc),
    event: event => id ? { ...event, operationId: id } : event,
    validate: current => {
      if (recorded(current)) throw createHttpError('This action has already been recorded.', 409);
      guard(current);
    },
  };
}
module.exports = { workflowOperation };
