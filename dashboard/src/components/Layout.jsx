import React, { useEffect, useRef, useState } from 'react';
import ThemeToggle from './ThemeToggle';
import formatBadgeCount from '../utils/formatBadgeCount';
import {
  LayoutDashboard,
  FileText,
  Send,
  Archive,
  Users,
  Building2,
  ScanLine,
  Monitor,
  Inbox,
  ArrowRightLeft,
  LogOut,
  ClipboardList,
  History,
  BarChart3,
  AlertCircle,
  Bell,
  Loader2,
  X,
  Menu,
  Clock,
  AlertTriangle,
  CheckCircle2,
  PenLine,
  XCircle,
} from 'lucide-react';

const NOTIFICATION_DOCK_SIZE = 46;
const NOTIFICATION_DOCK_MARGIN = 12;
const NOTIFICATION_POS_KEY = 'dp_notification_dock_pos';

const clampNotificationDockPosition = (x, y) => {
  if (typeof window === 'undefined') return { x, y };
  const maxX = window.innerWidth - NOTIFICATION_DOCK_SIZE - NOTIFICATION_DOCK_MARGIN;
  const maxY = window.innerHeight - NOTIFICATION_DOCK_SIZE - NOTIFICATION_DOCK_MARGIN;
  return {
    x: Math.min(Math.max(NOTIFICATION_DOCK_MARGIN, x), maxX),
    y: Math.min(Math.max(NOTIFICATION_DOCK_MARGIN, y), maxY),
  };
};

const getDefaultNotificationDockPosition = () => {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  const rootStyle = getComputedStyle(document.documentElement);
  const topbarHeight = parseFloat(rootStyle.getPropertyValue('--app-topbar-height')) || 120;
  const top = topbarHeight - 20 - NOTIFICATION_DOCK_SIZE;
  const right = 27.2;
  const x = window.innerWidth - right - NOTIFICATION_DOCK_SIZE;
  return clampNotificationDockPosition(x, top);
};

const loadNotificationDockPosition = () => {
  try {
    const raw = localStorage.getItem(NOTIFICATION_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
      return clampNotificationDockPosition(parsed.x, parsed.y);
    }
  } catch {
    // ignore invalid saved position
  }
  return null;
};

const Layout = ({
  children,
  currentPage,
  currentRole,
  currentUser,
  onNavigate,
  onLogout,
  onOpenProfile,
  pendingTransmissions,
  dataError,
  saveError,
  isLoadingContent = false,
  isRefreshingContent = false,
  notifications = [],
  onDismissNotification,
  onNotificationSelect,
}) => {
  const [isNotificationDockOpen, setIsNotificationDockOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [notificationDockPosition, setNotificationDockPosition] = useState(
    () => loadNotificationDockPosition() || getDefaultNotificationDockPosition(),
  );
  const [isNotificationDockDragging, setIsNotificationDockDragging] = useState(false);
  const notificationDockDragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const notificationDockPositionRef = useRef(notificationDockPosition);

  useEffect(() => {
    notificationDockPositionRef.current = notificationDockPosition;
  }, [notificationDockPosition]);

  useEffect(() => {
    const handleResize = () => {
      setNotificationDockPosition((prev) => clampNotificationDockPosition(prev.x, prev.y));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleNotificationDockPointerDown = (event) => {
    if (event.button !== 0) return;
    notificationDockDragRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      originX: notificationDockPositionRef.current.x,
      originY: notificationDockPositionRef.current.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleNotificationDockPointerMove = (event) => {
    const drag = notificationDockDragRef.current;
    if (!drag.active) return;

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4)) {
      drag.moved = true;
      setIsNotificationDockDragging(true);
    }
    if (!drag.moved) return;

    setNotificationDockPosition((prev) => {
      const next = clampNotificationDockPosition(drag.originX + deltaX, drag.originY + deltaY);
      notificationDockPositionRef.current = next;
      return next;
    });
  };

  const finishNotificationDockPointer = (event) => {
    const drag = notificationDockDragRef.current;
    if (!drag.active) return;

    drag.active = false;
    setIsNotificationDockDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (drag.moved) {
      try {
        localStorage.setItem(
          NOTIFICATION_POS_KEY,
          JSON.stringify(notificationDockPositionRef.current),
        );
      } catch {
        // ignore storage failures
      }
      return;
    }

    setIsNotificationDockOpen((prev) => !prev);
  };

  const handleNotificationDockDoubleClick = () => {
    const resetPosition = getDefaultNotificationDockPosition();
    setNotificationDockPosition(resetPosition);
    try {
      localStorage.removeItem(NOTIFICATION_POS_KEY);
    } catch {
      // ignore storage failures
    }
  };

  const notificationPanelOnRight = notificationDockPosition.x < 380;

  const handleNavigate = (id) => {
    onNavigate(id);
    setIsSidebarOpen(false);
  };

  // ==================== ADMIN NAV (was Superadmin) ====================
  const adminNav = [
    { group: 'Overview', items: [
      { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    ]},
    { group: 'Document Management', items: [
      { id: 'documents', label: 'All Documents', icon: <FileText size={18} /> },
      { id: 'archives', label: 'Archives', icon: <Archive size={18} /> },
    ]},
    { group: 'Administration', items: [
      { id: 'offices', label: 'Offices', icon: <Building2 size={18} /> },
      { id: 'users', label: 'User Management', icon: <Users size={18} /> },
      { id: 'document-types', label: 'Document Types', icon: <FileText size={18} /> },
    ]},
    { group: 'System', items: [
      { id: 'reports', label: 'Reports', icon: <BarChart3 size={18} /> },
      { id: 'logs', label: 'Activity Logs', icon: <History size={18} /> },
      { id: 'device-panel', label: 'Device Control', icon: <Monitor size={18} /> },
      { id: 'scan-documents', label: 'Scan Documents', icon: <ScanLine size={18} /> },
    ]},
  ];

  // ==================== MAYOR NAV ====================
  const mayorNav = [
    { group: 'Overview', items: [
      { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    ]},
    { group: 'Document Approval', items: [
      { id: 'documents', label: 'All Documents', icon: <FileText size={18} /> },
      { id: 'archives', label: 'Archives', icon: <Archive size={18} /> },
    ]},
    { group: 'Monitoring', items: [
      { id: 'reports', label: 'Reports', icon: <BarChart3 size={18} /> },
      { id: 'logs', label: 'Activity Logs', icon: <History size={18} /> },
    ]},
  ];

  // ==================== RECEPTIONIST NAV ====================
  const receptionistNav = [
    { group: 'Overview', items: [
      { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    ]},
    { group: 'Operations', items: [
      { id: 'scan-documents', label: 'Scan Document', icon: <ScanLine size={18} /> },
      { id: 'documents', label: 'Document Tracker', icon: <FileText size={18} /> },
    ]},
    { group: 'Tools', items: [
      { id: 'reports', label: 'Reports', icon: <BarChart3 size={18} /> },
      { id: 'logs', label: 'My Activity', icon: <History size={18} /> },
    ]},
  ];

  // ==================== OFFICE STAFF NAV ====================
  const officeNav = [
    { group: 'Overview', items: [
      { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    ]},
    { group: 'Send & Track', items: [
      { id: 'documents', label: 'My Documents', icon: <FileText size={18} /> },
    ]},
    { group: 'Monitoring', items: [
      { id: 'reports', label: 'Reports', icon: <BarChart3 size={18} /> },
      { id: 'logs', label: 'My Activity', icon: <History size={18} /> },
    ]},
  ];

  const getNavGroups = () => {
    switch (currentRole) {
      case 'admin': return adminNav;
      case 'mayor': return mayorNav;
      case 'office': return officeNav;
      case 'receptionist': return receptionistNav;
      default: return receptionistNav;
    }
  };

  const navGroups = getNavGroups();

  const userName = currentUser ? `${currentUser.fname} ${currentUser.lname}` : 'User';
  const userInitials = currentUser ? `${currentUser.fname[0]}${currentUser.lname[0]}` : 'U';
  const userRole = currentUser ? currentUser.role : currentRole;

  const getNotificationIcon = (item) => {
    const text = `${item.status || ''} ${item.text || ''}`.toLowerCase();
    if (text.includes('approved')) return <CheckCircle2 size={15} />;
    if (text.includes('rejected')) return <XCircle size={15} />;
    if (text.includes('received') || text.includes('registered') || text.includes('scanned')) return <Inbox size={15} />;
    if (text.includes('in transit') || text.includes('route') || text.includes('transmission')) return <ArrowRightLeft size={15} />;
    if (text.includes('signing') || text.includes('signature') || text.includes('signed')) return <PenLine size={15} />;
    if (text.includes('acknowledged')) return <CheckCircle2 size={15} />;
    if (text.includes('filing') || text.includes('archive')) return <Archive size={15} />;
    if (item.type === 'urgent') return <AlertTriangle size={15} />;
    if (item.type === 'overdue') return <Clock size={15} />;
    if (item.type === 'pending') return <Clock size={15} />;
    if (item.type === 'success') return <CheckCircle2 size={15} />;
    return <FileText size={15} />;
  };

  const pageContentRef = useRef(null);
  const mainContentRef = useRef(null);

  useEffect(() => {
    const scrollEl = mainContentRef.current || pageContentRef.current;
    scrollEl?.scrollTo({ top: 0, behavior: 'auto' });
  }, [currentPage]);

  return (
    <div className="layout">
      {isSidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        {/* Logo */}
        <div className="sidebar-header">
          <div className="logo">
            <div className="logo-icon-wrapper">
              <FileText size={20} color="white" />
            </div>
            <div className="logo-text">
              <span className="logo-title">DigiPath</span>
              <span className="logo-subtitle">Vinzons Document System</span>
            </div>
          </div>
          <div className="sidebar-header-actions">
            <ThemeToggle />
            <button
              type="button"
              className="sidebar-close-btn"
              onClick={() => setIsSidebarOpen(false)}
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {navGroups.map((group, gi) => (
            <div className="nav-group" key={gi}>
              <p className="nav-label">{group.group}</p>
              {group.items.map((item) => (
                <div
                  key={item.id}
                  className={`nav-item ${currentPage === item.id ? 'active' : ''}`}
                  onClick={() => handleNavigate(item.id)}
                >
                  {item.icon}
                  {item.label}
                  {item.badge > 0 && <span className="nav-badge">{formatBadgeCount(item.badge)}</span>}
                </div>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-user-row">
            <button
              type="button"
              className="user-profile-trigger"
              onClick={() => {
                onOpenProfile?.();
                setIsSidebarOpen(false);
              }}
              title="Profile settings"
              aria-label={`Open profile settings for ${userName}`}
            >
              <div className="user-avatar" aria-hidden="true">{userInitials}</div>
              <div className="user-details">
                <div className="user-name">{userName}</div>
                <div className="user-role">{userRole}</div>
              </div>
            </button>
            <button
              type="button"
              className="user-logout-btn"
              onClick={onLogout}
              title="Log out"
              aria-label={`Log out ${userName}`}
            >
              <LogOut size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content" ref={mainContentRef}>
        <div className="mobile-topbar">
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <div className="mobile-topbar-logo">
            <div className="logo-icon-wrapper mobile">
              <FileText size={16} color="white" />
            </div>
            <div className="mobile-topbar-logo-text">
              <span className="mobile-topbar-title">DigiPath</span>
              <span className="mobile-topbar-subtitle">Document System</span>
            </div>
          </div>
          <ThemeToggle className="mobile-topbar-theme" />
        </div>
        <div className="page-content" ref={pageContentRef}>
          {(dataError || saveError) && (
            <div className="page-content-alert" style={{
              marginBottom: '1rem',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
              background: 'var(--danger-bg)',
              color: 'var(--danger)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}>
              <AlertCircle size={16} />
              {saveError || dataError}
            </div>
          )}

          {isRefreshingContent && (
            <div className="page-content-refresh-bar" aria-live="polite">
              <Loader2 size={14} className="animate-spin" />
              <span>Refreshing content...</span>
            </div>
          )}

          <div className={`page-content-shell ${isRefreshingContent ? 'is-refreshing' : ''}`}>
            {isLoadingContent ? (
              <div className="page-content-loading">
                <Loader2 size={28} className="animate-spin" />
                <span>Loading page content...</span>
              </div>
            ) : (
              children
            )}
          </div>
        </div>
      </main>

      <aside
        className={[
          'notification-dock',
          isNotificationDockOpen ? 'open' : 'collapsed',
          isNotificationDockDragging ? 'is-dragging' : '',
          notificationPanelOnRight ? 'panel-right' : '',
        ].filter(Boolean).join(' ')}
        style={{
          top: `${notificationDockPosition.y}px`,
          left: `${notificationDockPosition.x}px`,
        }}
      >
        <button
          type="button"
          className="notification-dock-toggle"
          onPointerDown={handleNotificationDockPointerDown}
          onPointerMove={handleNotificationDockPointerMove}
          onPointerUp={finishNotificationDockPointer}
          onPointerCancel={finishNotificationDockPointer}
          onDoubleClick={handleNotificationDockDoubleClick}
          title="Drag to move. Click to open. Double-click to reset position."
          aria-label="Notifications. Drag to move, click to open."
        >
          <Bell size={16} />
          {notifications.length > 0 && (
            <span className="notification-dock-badge">{formatBadgeCount(notifications.length)}</span>
          )}
        </button>

        {isNotificationDockOpen && (
          <div className="notification-dock-panel">
            <div className="notification-dock-header">
              <div>
                <strong>Needs Attention</strong>
                <span>
                  {notifications.length} active item{notifications.length === 1 ? '' : 's'}
                </span>
              </div>
              <button className="btn-icon" onClick={() => setIsNotificationDockOpen(false)} title="Collapse notifications">
                <X size={15} />
              </button>
            </div>

            <div className="notification-dock-list">
              {notifications.length === 0 ? (
                <p className="notification-dock-empty">No new alerts right now.</p>
              ) : (
                notifications.map((item) => (
                  <div key={item.id} className="notification-row">
                    <button className={`notification-item ${item.type}`} onClick={() => onNotificationSelect ? onNotificationSelect(item) : onNavigate(item.page)}>
                      <span className="notification-status-symbol">{getNotificationIcon(item)}</span>
                      <span>{item.text}</span>
                    </button>
                    <button
                      className="notification-dismiss"
                      onClick={() => onDismissNotification?.(item.id)}
                      title="Dismiss notification"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};

export default Layout;
