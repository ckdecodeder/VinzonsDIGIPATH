export const workflowOperationId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)),
  byte => byte.toString(16).padStart(2, '0')).join('');

// An empty timeline read can race the write. A retry reuses the operation ID
// checked under the server's document lock, even if the original request is still running.
export async function saveWorkflowAction(attempt, { save, read, checkOnly = false }) {
  const { documentId, action, userId, operationId } = attempt;
  let failure;
  if (!checkOnly) {
    try {
      const document = await save(attempt);
      if (document?.id === documentId) return { state: 'saved', document };
    } catch (error) {
      const definite = error.code === 'API_UNAVAILABLE' || (error.status >= 400 && error.status < 500 && error.status !== 408);
      if (definite && error.status !== 409 && !attempt.state) throw error;
      failure = definite ? error : null;
    }
  }
  let document;
  try { document = await read(documentId); } catch { /* Keep the draft until a read succeeds. */ }
  if (document?.id === documentId && Array.isArray(document.timeline)) {
    if (document.timeline.some(event => event.operationId === operationId && event.userId === userId && event.action === action)) {
      return { state: 'saved', document };
    }
    if (failure && !attempt.state) throw failure;
    return { state: 'retry', message: failure?.message || 'No matching action is recorded yet. You can retry this save.' };
  }
  return { state: 'check', message: 'The save could not be confirmed. Check its status before retrying.' };
}
