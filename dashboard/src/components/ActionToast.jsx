import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Edit2, PlusCircle, Trash2 } from 'lucide-react';

const toastIcons = {
  created: PlusCircle,
  updated: Edit2,
  saved: CheckCircle2,
  deleted: Trash2,
};

const ActionToast = ({ toast, onDone }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!toast) {
      setVisible(false);
      return undefined;
    }

    setVisible(true);
    const hideTimer = setTimeout(() => setVisible(false), 2400);
    const doneTimer = setTimeout(() => onDone?.(), 2800);

    return () => {
      clearTimeout(hideTimer);
      clearTimeout(doneTimer);
    };
  }, [toast, onDone]);

  if (!toast) return null;

  const Icon = toastIcons[toast.type] || CheckCircle2;

  return createPortal(
    <div
      className={`action-toast action-toast-${toast.type} ${visible ? 'is-visible' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="action-toast-icon" aria-hidden="true">
        <Icon size={15} />
      </span>
      <span className="action-toast-message">{toast.message}</span>
    </div>,
    document.body,
  );
};

export default ActionToast;
