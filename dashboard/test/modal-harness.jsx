import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ModalOverlay from '../src/components/ModalOverlay';
import AppModal from '../src/components/AppModal';
import '../src/index.css';

if (!import.meta.env.DEV) throw new Error('Synthetic harness is development-only.');
const host = document.getElementById('root');
let root = createRoot(host);

window.runModalChecks = async () => {
  const checks = [];
  const check = (condition, description) => {
    if (!condition) throw new Error(description);
    checks.push(description);
  };
  let parent = false, child = false, empty = false, autoFocus = false, sibling = false;
  let parentCloses = 0, childCloses = 0;
  const existingInert = document.createElement('div');
  existingInert.setAttribute('inert', 'inert');
  document.body.append(existingInert);
  const closeParent = () => { parentCloses++; parent = false; paint(); };
  const closeChild = () => { childCloses++; child = false; paint(); };
  const childDialog = () => child && <ModalOverlay overlayClassName="scanned-preview-overlay" aria-labelledby="child-title" onClose={closeChild}>
    <div className="modal"><h2 id="child-title">Child preview</h2><button id="child-first">First child action</button><button id="child-last" onClick={closeChild}>Close child</button></div>
  </ModalOverlay>;
  const paint = () => flushSync(() => root.render(<StrictMode>
    <main style={{ padding: 24 }}>
      <h1>Synthetic modal focus checks</h1>
      <button id="trigger" onClick={() => { parent = true; paint(); }}>Open parent</button>
      {parent && <ModalOverlay aria-labelledby="parent-title" onClose={closeParent}>
        <div className="modal">
          <h2 id="parent-title">Parent document</h2>
          <button disabled>Disabled action</button><button hidden>Hidden action</button>
          <fieldset disabled><button>Disabled fieldset action</button></fieldset>
          <button style={{ display: 'none' }}>CSS hidden action</button>
          <button id="parent-first">First parent action</button>
          <button id="child-trigger" onClick={() => { child = true; paint(); }}>Open preview</button>
          {autoFocus && <input id="autofocus-field" aria-label="Remarks" autoFocus />}
          <button id="parent-last" onClick={closeParent}>Close parent</button>
          {!sibling && childDialog()}
        </div>
      </ModalOverlay>}
      {sibling && childDialog()}
      {empty && <ModalOverlay aria-label="Processing document" onClose={() => { empty = false; paint(); }}><div className="modal"><p>Processing document</p></div></ModalOverlay>}
    </main>
  </StrictMode>));
  const key = (name, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(event);
    return event;
  };
  const dialog = (title) => [...document.querySelectorAll('[role="dialog"]')].find(node => node.getAttribute('aria-labelledby') === title);
  const active = id => document.activeElement?.id === id;

  try {
    paint();
    document.getElementById('trigger').focus();
    document.getElementById('trigger').click();
    check(active('parent-first'), 'StrictMode opening focuses the first visible enabled control');
    check(host.inert && existingInert.inert && document.body.classList.contains('modal-open'), 'Modal makes page content inert and locks body scrolling');
    const parentDialog = dialog('parent-title');
    check(parentDialog.getAttribute('aria-modal') === 'true' && document.getElementById(parentDialog.getAttribute('aria-labelledby')).textContent === 'Parent document', 'One dialog semantic uses the explicit existing heading');
    document.getElementById('parent-last').focus();
    check(key('Tab').defaultPrevented && active('parent-first'), 'Tab wraps from last to first control');
    check(key('Tab', true).defaultPrevented && active('parent-last'), 'Shift+Tab wraps from first to last control');
    document.getElementById('trigger').focus();
    check(parentDialog.contains(document.activeElement), 'Inert background cannot receive programmatic focus');
    document.getElementById('parent-first').click();
    check(parent && !parentCloses, 'A content click does not close its overlay');

    const lateBackground = document.createElement('button');
    document.body.append(lateBackground);
    await Promise.resolve();
    check(lateBackground.inert, 'Content added while a modal is open also becomes inert');
    lateBackground.remove();
    document.getElementById('child-trigger').focus();
    document.getElementById('child-trigger').click();
    const childOverlay = dialog('child-title');
    check(active('child-first') && parentDialog.inert && !childOverlay.inert, 'A nested portal owns focus and makes its parent inert');
    check(Number(getComputedStyle(childOverlay).zIndex) > Number(getComputedStyle(parentDialog).zIndex), 'Nested preview stays above a parent with a higher CSS layer');
    parentDialog.click();
    check(parentCloses === 0 && childCloses === 0, 'Background backdrop cannot close a lower modal');
    document.getElementById('child-last').focus();
    check(key('Tab').defaultPrevented && active('child-first'), 'Tab containment applies only to the top modal');
    key('Escape');
    check(childCloses === 1 && parentCloses === 0 && active('child-trigger') && !parentDialog.inert, 'Escape closes only the nested modal and restores its parent trigger');
    parentDialog.click();
    check(parentCloses === 1 && active('trigger') && !host.inert, 'Top backdrop closes and restores the original page trigger');

    empty = true; paint();
    const emptyDialog = document.querySelector('[aria-label="Processing document"]');
    check(document.activeElement === emptyDialog, 'A dialog with no controls receives initial focus itself');
    check(key('Tab').defaultPrevented && document.activeElement === emptyDialog, 'An empty dialog retains keyboard focus');
    key('Escape');
    check(active('trigger'), 'An empty dialog restores its trigger');

    autoFocus = true; parent = true; paint();
    check(active('autofocus-field'), 'An existing React autoFocus field keeps initial focus');
    key('Escape'); autoFocus = false;
    check(active('trigger'), 'React autoFocus does not replace the remembered page trigger');

    parent = true; child = true; paint();
    check(active('child-first') && dialog('parent-title').inert, 'Initially mounted nested portals keep the child as the top modal');
    key('Escape');
    check(dialog('parent-title').contains(document.activeElement), 'Closing an initially mounted child focuses its parent');
    key('Escape');

    sibling = true; parent = true; paint();
    document.getElementById('child-trigger').focus(); document.getElementById('child-trigger').click();
    parent = false; paint();
    check(active('child-first') && !dialog('child-title').inert, 'Unmounting a lower parent preserves a sibling portal');
    key('Escape');
    check(active('trigger'), 'A surviving portal restores the original trigger after its parent unmounts');

    flushSync(() => root.render(<StrictMode><AppModal open title="First notice" /><AppModal open title="Second notice" /></StrictMode>));
    const notices = [...document.querySelectorAll('[role="dialog"]')];
    check(notices.length === 2 && new Set(notices.map(node => node.getAttribute('aria-labelledby'))).size === 2, 'Concurrent AppModal headings have unique dialog names');
    flushSync(() => root.unmount());
    check(!host.inert && existingInert.getAttribute('inert') === 'inert' && !document.body.classList.contains('modal-open'), 'Full unmount restores original inert attributes and body scroll state');
    const closes = parentCloses + childCloses;
    key('Escape');
    check(parentCloses + childCloses === closes, 'Full unmount removes stale Escape listeners');
    root = createRoot(host);
    flushSync(() => root.render(<main style={{ padding: 24 }}><h1>Modal checks passed</h1><ol>{checks.map(text => <li key={text}>{text}</li>)}</ol></main>));
    return { passed: checks.length, checks };
  } catch (error) {
    flushSync(() => root.unmount());
    root = createRoot(host);
    flushSync(() => root.render(<main role="alert">{error.message}</main>));
    throw error;
  } finally {
    existingInert.remove();
  }
};

root.render(<main style={{ padding: 24 }}><h1>Synthetic modal focus verification</h1><p>No backend, real records, or device services are used.</p><button onClick={() => window.runModalChecks().catch(console.error)}>Run modal checks</button></main>);
