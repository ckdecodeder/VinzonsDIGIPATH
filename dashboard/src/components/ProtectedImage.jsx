import { useEffect, useState } from 'react';
import { resolveUploadUrl } from '../utils/mediaUrl';
import { readMediaBlob } from '../utils/protectedMedia';

export default function ProtectedImage({ src, onError, ...props }) {
  const [loaded, setLoaded] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const resolved = resolveUploadUrl(src);
    const controller = new AbortController();
    let objectUrl;
    setLoaded('');
    setError('');
    if (!resolved) return undefined;
    if (/^(data:|blob:)/.test(resolved)) { setLoaded(resolved); return undefined; }
    readMediaBlob(resolved, controller.signal).then(blob => {
      if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setLoaded(objectUrl); }
    }).catch(error => { if (!controller.signal.aborted) { setError('Unable to load this scan. Reopen it to retry.'); onError?.(error); } });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  return loaded ? <img {...props} src={loaded} onError={onError} /> : <span role={error ? 'alert' : 'status'}>{error || 'Loading scan…'}</span>;
}
