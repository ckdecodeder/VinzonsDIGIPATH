export const focusFormError = (container) => {
  requestAnimationFrame(() => {
    if (!container?.isConnected) return;
    const summary = container.querySelector('[data-form-error]');
    if (!summary?.getClientRects().length) return;
    const dialogs = container.ownerDocument.querySelectorAll('[role="dialog"][aria-modal="true"]:not([inert])');
    const activeDialog = dialogs[dialogs.length - 1];
    if (activeDialog && !activeDialog.contains(summary)) return;
    summary.focus();
  });
};
