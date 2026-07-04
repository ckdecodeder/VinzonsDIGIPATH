import React from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

const modalIcons = {
  danger: <XCircle size={24} />,
  success: <CheckCircle2 size={24} />,
  warning: <AlertTriangle size={24} />,
  info: <Info size={24} />,
};

const AppModal = ({
  open,
  type = 'info',
  title = 'Notice',
  message = '',
  confirmLabel = 'OK',
  cancelLabel = '',
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  const variant = modalIcons[type] ? type : 'info';
  const isConfirm = Boolean(cancelLabel);
  const handleCancel = () => (onCancel || onConfirm)?.();

  return (
    <div className="modal-overlay app-dialog-overlay" onClick={handleCancel}>
      <div
        className={`modal app-dialog app-dialog-${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="app-dialog-body">
          <div className="app-dialog-icon" aria-hidden="true">
            {modalIcons[variant]}
          </div>
          <div className="app-dialog-content">
            <h2 id="app-dialog-title">{title}</h2>
            {message && <p>{message}</p>}
          </div>
        </div>
        <div className="modal-footer app-dialog-actions">
          {isConfirm && (
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className={`btn ${variant === 'danger' ? 'btn-danger' : variant === 'success' ? 'btn-success' : 'btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppModal;
