export function watchTrackingNumber(submittedNumber, track, setLookup) {
  if (!submittedNumber) return;
  const controller = new AbortController();
  let pending = false;
  const read = async () => {
    if (pending || controller.signal.aborted || document.hidden) return;
    pending = true;
    setLookup(prev => ({ ...(prev?.number === submittedNumber ? prev : {}), number: submittedNumber, loading: true }));
    try {
      const result = await track(submittedNumber, { signal: controller.signal });
      if (!controller.signal.aborted) setLookup({ number: submittedNumber, result, checked: new Date() });
    } catch (error) {
      if (!controller.signal.aborted) setLookup(prev => ({
        ...(prev?.number === submittedNumber && ![401, 403, 404].includes(error.status) ? prev : {}),
        number: submittedNumber, loading: false, error: error.message || 'Tracking lookup failed.',
      }));
    } finally {
      pending = false;
    }
  };
  read();
  const interval = setInterval(read, 15000);
  document.addEventListener('visibilitychange', read);
  return () => {
    controller.abort();
    clearInterval(interval);
    document.removeEventListener('visibilitychange', read);
  };
}
