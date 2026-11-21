import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the component's actual pointer handlers without a DOM dependency.
function harness({ headerHeight = '120px', fontSize = '16px', width = 1280, height = 800 } = {}) {
  const source = fs.readFileSync(new URL('../components/Layout.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  let position = { x: 100, y: 100 }, open = false, dragging = false, toggles = 0;
  const captured = new Set(), saved = new Map(), listeners = new Map();
  const dragRef = { current: { active: false, suppressClick: false } };
  const positionRef = { current: position };
  const defaultRef = { current: false };
  const element = {
    setPointerCapture: id => captured.add(id),
    hasPointerCapture: id => captured.has(id),
    releasePointerCapture: id => captured.delete(id),
  };
  const context = {
    module: { exports: {} },
    window: { innerWidth: width, innerHeight: height,
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name) },
    document: { documentElement: {} },
    getComputedStyle: () => ({ fontSize, getPropertyValue: () => headerHeight }),
    localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    notificationDockDragRef: dragRef,
    notificationDockPositionRef: positionRef,
    notificationDockIsDefaultRef: defaultRef,
    setNotificationDockPosition: next => { position = typeof next === 'function' ? next(position) : next; positionRef.current = position; },
    setIsNotificationDockDragging: next => { dragging = next; },
    setIsNotificationDockOpen: next => { open = next(open); toggles++; },
    useEffect: effect => effect(),
  };
  vm.runInNewContext(
    source.slice(source.indexOf('const NOTIFICATION_DOCK_SIZE'), source.indexOf('const Layout ='))
    + source.slice(source.indexOf('  useEffect(() => {\n    const handleResize'), source.indexOf('  const handleNotificationDockPointerDown'))
    + source.slice(source.indexOf('  const handleNotificationDockPointerDown'), source.indexOf('  const notificationPanelOnRight'))
    + '\nmodule.exports = { down: handleNotificationDockPointerDown, move: handleNotificationDockPointerMove, up: finishNotificationDockPointer, cancel: cancelNotificationDockDrag, click: handleNotificationDockClick, reset: handleNotificationDockDoubleClick, defaultPosition: getDefaultNotificationDockPosition, loadPosition: loadNotificationDockPosition };',
    context,
  );
  return {
    ...context.module.exports, saved, captured, dragRef, positionRef,
    event: (overrides = {}) => ({ button: 0, isPrimary: true, pointerId: 1, clientX: 100, clientY: 100, currentTarget: element, ...overrides }),
    blur: () => listeners.get('blur')(),
    resize(nextWidth, nextHeight) { context.window.innerWidth = nextWidth; context.window.innerHeight = nextHeight; listeners.get('resize')(); },
    set atDefault(value) { defaultRef.current = value; },
    get open() { return open; }, get dragging() { return dragging; }, get toggles() { return toggles; }, get position() { return position; },
  };
}

test('desktop notification defaults resolve rem and px headers to the reserved slot', () => {
  for (const headerHeight of ['7.5rem', '120px']) {
    const app = harness({ headerHeight, width: 1366, height: 768 });
    assert.equal(app.defaultPosition().x, 1292.8);
    assert.equal(app.defaultPosition().y, 54);
  }
  assert.equal(harness({ headerHeight: '7.5rem', fontSize: '20px' }).defaultPosition().y, 84);
});

test('only legacy corner positions reset; valid custom positions survive loading', () => {
  const app = harness({ width: 1366, height: 768 });
  app.saved.set('dp_notification_dock_pos', JSON.stringify({ x: 1292.8, y: 12 }));
  assert.equal(app.loadPosition(), null);
  app.saved.set('dp_notification_dock_pos', JSON.stringify({ x: 400, y: 240 }));
  assert.deepEqual(JSON.parse(JSON.stringify(app.loadPosition())), { x: 400, y: 240 });
  app.saved.set('dp_notification_dock_pos', '{"x":1e999,"y":12}');
  assert.equal(app.loadPosition(), null);
});

test('default notification placement follows desktop resize, while custom positions stay put', () => {
  const app = harness({ width: 1366, height: 768 });
  app.atDefault = true; app.resize(1920, 1080);
  assert.equal(app.position.x, 1846.8); assert.equal(app.position.y, 54);
  app.atDefault = false; app.resize(1366, 768);
  assert.equal(app.position.x, 1308); assert.equal(app.position.y, 54);
  app.reset(); app.resize(1920, 1080);
  assert.equal(app.position.x, 1846.8); assert.equal(app.position.y, 54);
  app.down(app.event()); app.move(app.event({ clientX: 75 })); app.up(app.event());
  const dragged = app.position;
  app.resize(1920, 1000);
  assert.deepEqual(app.position, dragged);
});

test('notification activation belongs to click, including native keyboard clicks', () => {
  const app = harness();
  app.down(app.event()); app.move(app.event({ clientX: 104 })); app.up(app.event());
  assert.equal(app.toggles, 0);
  app.click({ detail: 1 });
  assert.equal(app.open, true); assert.equal(app.toggles, 1);
  app.click({ detail: 0 });
  assert.equal(app.open, false); assert.equal(app.toggles, 2);
});

test('dragging saves position and suppresses only its click, allowing the next activation', () => {
  const app = harness();
  app.down(app.event()); app.move(app.event({ clientX: 125, clientY: 140 }));
  assert.equal(app.dragging, true);
  app.up(app.event()); app.click({ detail: 1 });
  assert.equal(app.open, false); assert.equal(app.toggles, 0); assert.equal(app.dragging, false);
  assert.equal(app.captured.size, 0);
  assert.deepEqual(JSON.parse(app.saved.get('dp_notification_dock_pos')), { x: 125, y: 140 });
  app.click({ detail: 0 });
  assert.equal(app.open, true);
  app.down(app.event()); app.up(app.event()); app.click({ detail: 1 });
  assert.equal(app.open, false);
});

test('cancellation, lost capture and focus loss end gestures without activation', () => {
  for (const moved of [false, true]) {
    for (const cancelBy of ['cancel', 'blur']) {
      const app = harness(); app.down(app.event());
      if (moved) app.move(app.event({ clientX: 120 }));
      app[cancelBy](); app.cancel(); app.up(app.event()); app.click({ detail: 1 });
      assert.equal(app.dragRef.current.active, false);
      assert.equal(app.dragging, false); assert.equal(app.captured.size, 0); assert.equal(app.toggles, 0);
      app.click({ detail: 0 });
      assert.equal(app.open, true);
    }
  }
});

test('unrelated pointers do not move or finish an active drag; reset clears saved position', () => {
  const app = harness();
  app.down(app.event({ button: 2 })); app.down(app.event({ isPrimary: false }));
  assert.equal(app.dragRef.current.active, false);
  app.down(app.event()); app.down(app.event({ pointerId: 2 }));
  app.move(app.event({ pointerId: 2, clientX: 200 })); app.up(app.event({ pointerId: 2 }));
  assert.equal(app.dragRef.current.active, true); assert.equal(app.dragging, false);
  app.move(app.event({ clientX: 200 })); app.up(app.event());
  assert.equal(app.saved.size, 1);
  app.reset();
  assert.equal(app.saved.size, 0); assert.equal(app.position.x, app.positionRef.current.x);
  assert.equal(app.position.y, 54); assert.equal(app.toggles, 0);
});

function sidebarHarness() {
  const source = fs.readFileSync(new URL('../components/Layout.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const effect = source.slice(source.indexOf('  useEffect(() => {\n    if (!isSidebarOpen)'), source.indexOf('  // ==================== ADMIN NAV'));
  let cleanup, listener, mobile = true, modalOpen = false, navFocus = 0, menuFocus = 0, requestedOpen;
  const context = vm.createContext({
    window: { matchMedia: () => ({ get matches() { return mobile; } }) },
    document: { body: { classList: { contains: () => modalOpen } },
      addEventListener: (name, callback) => { listener = callback; }, removeEventListener: () => { listener = null; } },
    sidebarRef: { current: { querySelector: () => ({ focus: () => { navFocus++; } }) } },
    mobileMenuRef: { current: { focus: () => { menuFocus++; } } },
    setIsSidebarOpen: next => { requestedOpen = next; },
    useEffect: callback => { cleanup = callback(); },
  });
  return {
    render(open) { cleanup?.(); cleanup = null; context.isSidebarOpen = open; vm.runInContext(effect, context); },
    escape(defaultPrevented = false) { listener?.({ key: 'Escape', defaultPrevented, preventDefault() { this.defaultPrevented = true; } }); },
    set mobile(value) { mobile = value; }, set modalOpen(value) { modalOpen = value; },
    get navFocus() { return navFocus; }, get menuFocus() { return menuFocus; }, get requestedOpen() { return requestedOpen; },
  };
}

test('mobile sidebar focuses navigation on open and restores its menu trigger on close', () => {
  const app = sidebarHarness(); app.render(false);
  assert.equal(app.menuFocus, 0);
  app.render(true); assert.equal(app.navFocus, 1);
  app.escape(true); assert.equal(app.requestedOpen, undefined);
  app.escape(); assert.equal(app.requestedOpen, false);
  app.render(false); assert.equal(app.menuFocus, 1);
});

test('sidebar focus and Escape respect desktop layout and an active modal', () => {
  const app = sidebarHarness(); app.mobile = false; app.render(true);
  app.escape(); assert.equal(app.requestedOpen, undefined); assert.equal(app.navFocus, 0);
  app.render(false); assert.equal(app.menuFocus, 0);
  app.mobile = true; app.render(true); app.modalOpen = true;
  app.escape(); assert.equal(app.requestedOpen, undefined);
  app.render(false); assert.equal(app.menuFocus, 0);
});
