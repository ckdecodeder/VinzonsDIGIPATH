import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

let openModalCount = 0;

const ModalOverlay = ({ onClose, overlayClassName = '', children }) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    openModalCount += 1;
    if (openModalCount === 1) {
      document.body.classList.add('modal-open');
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onCloseRef.current?.();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) {
        document.body.classList.remove('modal-open');
      }
    };
  }, []);

  return createPortal(
    <div
      className={`modal-overlay ${overlayClassName}`.trim()}
      onClick={() => onCloseRef.current?.()}
    >
      {children}
    </div>,
    document.body,
  );
};

export default ModalOverlay;
