import React, { createContext, useContext, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

const ModalParent = createContext(null);
const openModals = [];
const backgroundInert = new Map();
let backgroundObserver;
let wasModalOpen = false;

const topModal = () => openModals[openModals.length - 1];
const focusableSelector = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, iframe, object, embed, [contenteditable]:not([contenteditable="false"]), [tabindex]';

const focusableElements = (element) => [...element.querySelectorAll(focusableSelector)]
  .filter(node => node.tabIndex >= 0 && !node.matches(':disabled') && !node.closest('[inert], [hidden]')
    && node.getClientRects().length && !['hidden', 'collapse'].includes(getComputedStyle(node).visibility))
  .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));

const focusModal = (modal) => {
  const elements = focusableElements(modal.element);
  const target = elements.includes(modal.lastFocused) ? modal.lastFocused : elements[0] || modal.element;
  target.focus({ preventScroll: true });
};

const syncBackground = () => {
  const active = topModal();
  if (!active) {
    backgroundInert.forEach((value, element) => {
      if (value === null) element.removeAttribute('inert');
      else element.setAttribute('inert', value);
    });
    backgroundInert.clear();
    return;
  }

  for (const element of document.body.children) {
    if (!backgroundInert.has(element)) backgroundInert.set(element, element.getAttribute('inert'));
    if (element === active.element) element.removeAttribute('inert');
    else element.setAttribute('inert', '');
  }
  let layer = 0;
  for (const modal of openModals) {
    layer = Math.max(layer + 1, modal.baseLayer);
    modal.element.style.zIndex = String(layer);
  }
};

const onFocusIn = (event) => {
  const active = topModal();
  if (!active) return;
  if (active.element.contains(event.target)) active.lastFocused = event.target;
  else focusModal(active);
};

const onKeyDown = (event) => {
  const active = topModal();
  if (!active || event.defaultPrevented) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    active.onClose.current?.();
  } else if (event.key === 'Tab') {
    const elements = focusableElements(active.element);
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (!first || !elements.includes(document.activeElement)
      || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last || active.element : first || active.element).focus({ preventScroll: true });
    }
  }
};

const ModalOverlay = ({ onClose, overlayClassName = '', children, 'aria-labelledby': labelledBy, 'aria-label': label }) => {
  const parent = useContext(ModalParent);
  const overlayRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const modalRef = useRef(null);
  onCloseRef.current = onClose;
  if (!modalRef.current) modalRef.current = { parent, returnFocus: document.activeElement, onClose: onCloseRef };

  useLayoutEffect(() => {
    const modal = modalRef.current;
    modal.element = overlayRef.current;
    if (modal.element.contains(document.activeElement)) modal.lastFocused = document.activeElement;
    modal.baseLayer = Number.parseInt(getComputedStyle(modal.element).zIndex, 10) || 200;
    const previousLayer = modal.element.style.zIndex;
    // Child layout effects run first, so insert an initially nested parent below its portals.
    const childIndex = openModals.findIndex((entry) => {
      for (let ancestor = entry.parent; ancestor; ancestor = ancestor.parent) if (ancestor === modal) return true;
      return false;
    });
    openModals.splice(childIndex < 0 ? openModals.length : childIndex, 0, modal);
    if (openModals.length === 1) {
      wasModalOpen = document.body.classList.contains('modal-open');
      document.body.classList.add('modal-open');
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('focusin', onFocusIn);
      backgroundObserver = new MutationObserver(syncBackground);
      backgroundObserver.observe(document.body, { childList: true });
    }
    syncBackground();
    if (topModal() === modal && !modal.element.contains(document.activeElement)) focusModal(modal);

    return () => {
      const wasTop = topModal() === modal;
      openModals.splice(openModals.indexOf(modal), 1);
      // A parent can unmount before its child portal; keep the original return path.
      for (const entry of openModals) {
        if (modal.element.contains(entry.returnFocus)) entry.returnFocus = modal.returnFocus;
      }
      modal.element.style.zIndex = previousLayer;
      if (!openModals.length) {
        backgroundObserver.disconnect();
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('focusin', onFocusIn);
        if (!wasModalOpen) document.body.classList.remove('modal-open');
      }
      syncBackground();
      if (wasTop) {
        const active = topModal();
        const trigger = modal.returnFocus;
        if (trigger?.isConnected && !trigger.closest('[inert]') && (!active || active.element.contains(trigger))) {
          trigger.focus({ preventScroll: true });
        }
        if (active && !active.element.contains(document.activeElement)) focusModal(active);
      }
    };
  }, []);

  return createPortal(
    <ModalParent.Provider value={modalRef.current}>
      <div
        ref={overlayRef}
        className={`modal-overlay ${overlayClassName}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => {
          if (event.target === event.currentTarget && topModal() === modalRef.current) onCloseRef.current?.();
        }}
      >
        {children}
      </div>
    </ModalParent.Provider>,
    document.body,
  );
};

export default ModalOverlay;
