import React, { useEffect, useState } from 'react';
import { Users, Search, Shield, ShieldCheck, Building2, Mail, ScanLine, Plus, X, Edit2, Trash2 } from 'lucide-react';

const UserList = ({ users, offices, onAddUser, onUpdateUser, onDeleteUser }) => {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    fname: '',
    lname: '',
    mname: '',
    role: 'Receptionist',
    officeId: offices.length > 0 ? offices[0].id : '',
  });

  const roleColors = {
    Admin: { bg: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', icon: <ShieldCheck size={10} /> },
    Mayor: { bg: 'var(--info-bg)', color: 'var(--info)', icon: <Shield size={10} /> },
    Receptionist: { bg: 'var(--success-bg)', color: 'var(--success)', icon: <ScanLine size={10} /> },
  };

  const getOfficeName = (id) => {
    const o = offices.find(x => x.id === id);
    return o ? o.name : 'Unknown';
  };

  const filteredUsers = users.filter(u =>
    (u.username || '').toLowerCase().includes(search.toLowerCase()) ||
    `${u.fname || ''} ${u.lname || ''}`.toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const paginatedUsers = filteredUsers.slice((page - 1) * pageSize, page * pageSize);
  const showFrom = filteredUsers.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const showTo = Math.min(page * pageSize, filteredUsers.length);

  const handlePageSizeChange = (value) => {
    setPageSize(value);
    setPage(1);
  };

  const handlePageChange = (newPage) => {
    const normalized = Math.min(Math.max(1, newPage), totalPages);
    setPage(normalized);
  };

  useEffect(() => {
    setPage(1);
  }, [search, users]);

  const buildPayload = () => ({
    username: formData.username.trim(),
    password: formData.password.trim(),
    fname: formData.fname.trim(),
    lname: formData.lname.trim(),
    mname: formData.mname.trim(),
    role: formData.role,
    officeId: formData.officeId,
  });

  const validatePayload = (payload) => {
    if (!payload.fname || !payload.lname || !payload.username) {
      return 'First name, last name, and username are required.';
    }

    if (!editUser && !payload.password) {
      return 'Password is required for a new user.';
    }

    if (payload.password && payload.password.length < 6) {
      return 'Password must be at least 6 characters long.';
    }

    const duplicateUsername = users.some(user =>
      user.id !== editUser?.id &&
      (user.username || '').toLowerCase() === payload.username.toLowerCase()
    );

    if (duplicateUsername) {
      return 'That username is already used by another account.';
    }

    return '';
  };

  const closeForm = () => {
    if (isSaving) return;
    setShowForm(false);
    setEditUser(null);
    setFormError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const payload = buildPayload();
    const validationError = validatePayload(payload);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setFormError('');
    setIsSaving(true);

    try {
      if (editUser) {
        const updatePayload = { ...payload };
        if (!updatePayload.password) {
          delete updatePayload.password;
        }
        await onUpdateUser(editUser.id, updatePayload);
      } else {
        await onAddUser(payload);
      }

      setShowForm(false);
      setEditUser(null);
    } catch (err) {
      setFormError(err.message || 'Unable to save this user.');
    } finally {
      setIsSaving(false);
    }
  };

  const openForm = (user = null) => {
    setFormError('');
    if (user) {
      setEditUser(user);
      setFormData({
        username: user.username || '',
        password: '',
        fname: user.fname || '',
        lname: user.lname || '',
        mname: user.mname || '',
        role: user.role || 'Receptionist',
        officeId: user.officeId || offices[0]?.id || '',
      });
    } else {
      setEditUser(null);
      setFormData({
        username: '',
        password: '',
        fname: '',
        lname: '',
        mname: '',
        role: 'Receptionist',
        officeId: offices.length > 0 ? offices[0].id : '',
      });
    }
    setShowForm(true);
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <h1>User Management</h1>
          <p>Manage system users and their access levels</p>
        </div>
      </div>

      <div className="page-toolbar-row">
        <div className="search-bar">
          <Search size={16} color="var(--text-muted)" />
          <input
            type="text"
            placeholder="Search users..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <button className="btn btn-primary" onClick={() => openForm()}>
          <Plus size={16} /> New User
        </button>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>ID</th>
              <th>Role</th>
              <th>Office</th>
              <th>Username</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedUsers.map(u => {
              const normalizedRole = u.role;
              const rc = roleColors[normalizedRole] || roleColors.Receptionist;
              return (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div className="user-avatar">{u.fname?.[0] || '?'}{u.lname?.[0] || ''}</div>
                      <div>
                        <div className="td-primary">{u.fname} {u.mname} {u.lname}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className="td-mono">{u.id}</span></td>
                  <td>
                    <span style={{
                      padding: '0.2rem 0.6rem',
                      borderRadius: '9999px',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      background: rc.bg,
                      color: rc.color,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}>
                      {rc.icon}
                      {normalizedRole}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'var(--text-secondary)' }}>
                      <Building2 size={14} style={{ color: 'var(--text-muted)' }} />
                      {getOfficeName(u.officeId)}
                    </div>
                  </td>
                  <td>
                    <span className="td-mono" style={{ fontSize: '0.78rem' }}>
                      {u.username || '—'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.375rem' }}>
                      <button className="btn-icon" title="Edit" onClick={() => openForm(u)}>
                        <Edit2 size={14} />
                      </button>
                      <button className="btn-icon" title="Delete" onClick={() => onDeleteUser(u.id)}
                        style={{ color: 'var(--danger)' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="pagination-toolbar">
        <div className="pagination-summary">
          Showing {showFrom}-{showTo} of {filteredUsers.length} matching users
        </div>
        <div className="pagination-controls">
          <label>
            Rows per page
            <input
              type="number"
              min="1"
              max="100"
              step="1"
              value={pageSize}
              className="form-input pagination-page-size-input"
              onChange={e => handlePageSizeChange(Number(e.target.value) || 1)}
            />
          </label>
        </div>
        <div className="pagination-pages">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={page <= 1}
            onClick={() => handlePageChange(page - 1)}
          >
            Previous
          </button>
          <span>Page {page} of {totalPages}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={page >= totalPages}
            onClick={() => handlePageChange(page + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editUser ? 'Edit User' : 'New User'}</h2>
              <button className="btn-icon" onClick={closeForm} disabled={isSaving}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {formError && (
                  <div style={{
                    marginBottom: '1rem',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--danger-bg)',
                    color: 'var(--danger)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                  }}>
                    {formError}
                  </div>
                )}
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">First Name *</label>
                    <input className="form-input" type="text" value={formData.fname} onChange={e => setFormData({ ...formData, fname: e.target.value })} required />
                    <p className="field-hint">Given name shown in user lists and activity logs.</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Last Name *</label>
                    <input className="form-input" type="text" value={formData.lname} onChange={e => setFormData({ ...formData, lname: e.target.value })} required />
                    <p className="field-hint">Family name used for sorting users and reports.</p>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Middle Name</label>
                  <input className="form-input" type="text" value={formData.mname} onChange={e => setFormData({ ...formData, mname: e.target.value })} />
                  <p className="field-hint">Optional middle name or initial for complete records.</p>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Role</label>
                    <select className="form-select" value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })}>
                      <option>Receptionist</option>
                      <option>Mayor</option>
                      <option>Admin</option>
                    </select>
                    <p className="field-hint">Controls the dashboards, actions, and reports this user can access.</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Assigned Office</label>
                    <select className="form-select" value={formData.officeId} onChange={e => setFormData({ ...formData, officeId: e.target.value })}>
                      {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <p className="field-hint">Limits office-level work such as receiving, routing, and visibility.</p>
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Username *</label>
                    <input className="form-input" type="text" value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} required />
                    <p className="field-hint">The sign-in name this user enters on the login screen.</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">{editUser ? 'Password' : 'Password *'}</label>
                    <input
                      className="form-input"
                      type="password"
                      value={formData.password}
                      onChange={e => setFormData({ ...formData, password: e.target.value })}
                      placeholder={editUser ? 'Leave blank to keep current password' : ''}
                      required={!editUser}
                    />
                    <p className="field-hint">{editUser ? 'Leave blank to keep the current password.' : 'Temporary password for the new account sign-in.'}</p>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeForm} disabled={isSaving}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSaving}>
                  {isSaving ? 'Saving...' : editUser ? 'Update User' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserList;
