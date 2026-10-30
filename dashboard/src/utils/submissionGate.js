// Claim synchronously, before file conversion/network work or React's next render.
// Each mounted form owns its gate; distinct deliberate registrations remain allowed.
export const createSubmissionGate = (setBusy = () => {}) => {
  let pending = false;
  return async work => {
    if (pending) return;
    pending = true;
    try {
      setBusy(true);
      return await work();
    } finally {
      pending = false;
      setBusy(false);
    }
  };
};
