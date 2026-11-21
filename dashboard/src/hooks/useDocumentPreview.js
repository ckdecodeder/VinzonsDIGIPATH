import { useEffect, useState } from 'react';

export function useDocumentPreview(documentId, userId, revision, loadDocument, onUnavailable) {
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!documentId || !userId) { setResult(null); return undefined; }
    const controller = new AbortController();
    let active = true;
    setResult({ documentId, userId, revision, attempt, document: null, error: '' });
    loadDocument(documentId, { signal: controller.signal }).then(document => {
      if (active) setResult({ documentId, userId, revision, attempt, document, error: '' });
    }).catch(error => {
      if (!active) return;
      if ([401, 403, 404].includes(error.status)) { onUnavailable(); return; }
      setResult({ documentId, userId, revision, attempt, document: null,
        error: error.message || 'Document details could not be refreshed. Please retry.' });
    });
    return () => { active = false; controller.abort(); };
  }, [documentId, userId, revision, attempt, loadDocument, onUnavailable]);
  const current = result?.documentId === documentId && result?.userId === userId
    && result?.revision === revision && result?.attempt === attempt ? result : null;
  return { document: current?.document || null, error: current?.error || '',
    loading: Boolean(documentId && !current?.document && !current?.error),
    retry: () => setAttempt(value => value + 1) };
}
