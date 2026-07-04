import React, { useEffect, useRef, useState } from 'react';
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
  X,
  Clock,
  AlertTriangle,
  CheckCircle2,
  PenLine,
  XCircle,
} from 'lucide-react';

const Layout = ({
  children,
  currentPage,
  currentRole,
  currentUser,
  onNavigate,
  onLogout,
  pendingTransmissions,
  dataError,
  saveError,
  notifications = [],
  onDismissNotification,
  onNotificationSelect,
}) => {
  const [isNotificationDockOpen, setIsNotificationDockOpen] = useState(false);

  // ==================== ADMIN NAV (was Superadmin) ====================
  const adminNav = [
    { group: 'Overview', items: [
      { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    ]},
    { group: 'Document Management', items: [
      { id: 'documents', label: 'All Documents', icon: <FileText size={18} /> },
      { id: 'transmissions', label: 'Transmissions', icon: <ArrowRightLeft size={18} />, badge: pendingTransmissions },
      { id: 'archives', label: 'Archives', icon: <Archive size={18} /> },
    ]},
    { group: 'Administration', items: [
      { id: 'offices', label: 'Offices', icon: <Building2 size={18} /> },
      { id: 'users', label: 'User Management', icon: <Users size={18} /> },
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
      { id: 'transmissions', label: 'Transmissions', icon: <ArrowRightLeft size={18} />, badge: pendingTransmissions },
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

  const getNavGroups = () => {
    switch (currentRole) {
      case 'admin': return adminNav;
      case 'mayor': return mayorNav;
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

  useEffect(() => {
    pageContentRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [currentPage]);

  return (
    <div className="layout">
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-header">
          <div className="logo">
            <div className="logo-icon-wrapper">
              <FileText size={20} color="white" />
            </div>
            <div className="logo-text">
              <span className="logo-title">DigiPath</span>
              <span className="logo-subtitle">Vinzon's Document System</span>
            </div>
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
                  onClick={() => onNavigate(item.id)}
                >
                  {item.icon}
                  {item.label}
                  {item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
                </div>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{userInitials}</div>
            <div className="user-details">
              <div className="user-name">{userName}</div>
              <div className="user-role">{userRole}</div>
            </div>
            <LogOut
              size={16}
              style={{ color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}
              onClick={onLogout}
              title="Log out"
              aria-label="Log out"
            />
          </div>
        </div>
      </aside>

      <main className="main-content">
        <div className="page-content" ref={pageContentRef}>
          {(dataError || saveError) && (
            <div style={{
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
          {children}
        </div>
      </main>

      {notifications.length > 0 && (
        <aside className={`notification-dock ${isNotificationDockOpen ? 'open' : 'collapsed'}`}>
          <button
            type="button"
            className="notification-dock-toggle"
            onClick={() => setIsNotificationDockOpen(prev => !prev)}
            title={isNotificationDockOpen ? 'Hide notifications' : 'Show notifications'}
          >
            <Bell size={16} />
            <span>{notifications.length}</span>
          </button>

          {isNotificationDockOpen && (
            <div className="notification-dock-panel">
              <div className="notification-dock-header">
                <div>
                  <strong>Needs Attention</strong>
                  <span>{notifications.length} active item{notifications.length === 1 ? '' : 's'}</span>
                </div>
                <button className="btn-icon" onClick={() => setIsNotificationDockOpen(false)} title="Collapse notifications">
                  <X size={15} />
                </button>
              </div>

              <div className="notification-dock-list">
                {notifications.map((item) => (
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
                ))}
              </div>
            </div>
          )}
        </aside>
      )}
    </div>
  );
};

export default Layout;
