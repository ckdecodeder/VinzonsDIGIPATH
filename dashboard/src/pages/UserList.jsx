import { focusFormError } from '../utils/formAccessibility';
import React, { useId, useEffect, useMemo, useState } from "react";
import PageShell from '../components/PageShell';
import ModalOverlay from '../components/ModalOverlay';
import {
  Search,
  Shield,
  ShieldCheck,
  Building2,
  ScanLine,
  Plus,
  X,
  Edit2,
  Trash2,
  Briefcase,
} from "lucide-react";
import {
  defaultRoleForOffice,
  getAvailableRoles,
  ROLE_HINTS,
  validateRoleAssignment,
} from "../utils/userRoles";

const UserList = ({
  users,
  offices,
  onAddUser,
  onUpdateUser,
  onDeleteUser,
}) => {
  const formId = useId();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [formError, setFormError] = useState("");
  const [invalidFields, setInvalidFields] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);

  const [formData, setFormData] = useState({
    username: "",
    password: "",
    fname: "",
    lname: "",
    mname: "",
    role: "Receptionist",
    officeId: offices.length > 0 ? offices[0].id : "",
  });

  const availableRoles = useMemo(
    () =>
      getAvailableRoles({
        offices,
        officeId: formData.officeId,
        users,
        excludeUserId: editUser?.id || null,
      }),
    [offices, formData.officeId, users, editUser?.id],
  );

  const roleColors = {
    Admin: {
      bg: "var(--danger-bg)",
      color: "var(--danger)",
      icon: <ShieldCheck size={10} />,
    },
    Mayor: {
      bg: "var(--info-bg)",
      color: "var(--info)",
      icon: <Shield size={10} />,
    },
    Receptionist: {
      bg: "var(--success-bg)",
      color: "var(--success)",
      icon: <ScanLine size={10} />,
    },
    Office: {
      bg: "var(--warning-bg)",
      color: "var(--warning)",
      icon: <Briefcase size={10} />,
    },
  };

  const getOfficeName = (id) => {
    const o = offices.find((x) => x.id === id);
    return o ? o.name : "Unknown";
  };

  const filteredUsers = users.filter((u) => {
    const term = search.toLowerCase();
    if (!term) return true;
    const fullName = `${u.fname || ""} ${u.mname || ""} ${u.lname || ""}`;
    return (
      (u.username || "").toLowerCase().includes(term) ||
      fullName.toLowerCase().includes(term) ||
      (u.role || "").toLowerCase().includes(term) ||
      getOfficeName(u.officeId).toLowerCase().includes(term)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const paginatedUsers = filteredUsers.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );
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
      return { message: "First name, last name, and username are required.", fields: ["fname", "lname", "username"].filter(key => !payload[key]) };
    }

    if (!payload.role) {
      return { message: "No role is available for the selected office. Choose a different office or free up an Admin/Mayor slot.", fields: ["officeId", "role"] };
    }

    if (!editUser && !payload.password) {
      return { message: "Password is required for a new user.", fields: ["password"] };
    }

    if (payload.password && payload.password.length < 6) {
      return { message: "Password must be at least 6 characters long.", fields: ["password"] };
    }

    const duplicateUsername = users.some(
      (user) =>
        user.id !== editUser?.id &&
        (user.username || "").toLowerCase() === payload.username.toLowerCase(),
    );

    if (duplicateUsername) {
      return { message: "That username is already used by another account.", fields: ["username"] };
    }

    const roleError = validateRoleAssignment({
      role: payload.role,
      officeId: payload.officeId,
      offices,
      users,
      excludeUserId: editUser?.id || null,
    });
    if (roleError) {
      return { message: roleError, fields: ["officeId", "role"] };
    }

    return "";
  };

  const handleOfficeChange = (officeId) => {
    setFormData((prev) => {
      const roles = getAvailableRoles({
        offices,
        officeId,
        users,
        excludeUserId: editUser?.id || null,
      });
      const nextRole = roles.includes(prev.role)
        ? prev.role
        : defaultRoleForOffice(officeId, offices, users, editUser?.id || null);
      return { ...prev, officeId, role: nextRole };
    });
  };

  useEffect(() => {
    if (!showForm) return;
    if (!availableRoles.includes(formData.role)) {
      setFormData((prev) => ({
        ...prev,
        role:
          availableRoles[0] ||
          defaultRoleForOffice(
            prev.officeId,
            offices,
            users,
            editUser?.id || null,
          ),
      }));
    }
  }, [availableRoles, formData.role, offices, showForm, users, editUser?.id]);

  const closeForm = () => {
    if (isSaving) return;
    setShowForm(false);
    setEditUser(null);
    setFormError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;

    const payload = buildPayload();
    const validationError = validatePayload(payload);
    if (validationError) {
      setFormError(validationError.message);
      setInvalidFields(validationError.fields);
      focusFormError(form);
      return;
    }

    setFormError("");
    setInvalidFields([]);
    setIsSaving(true);

    try {
      let saved;
      if (editUser) {
        const updatePayload = { ...payload };
        if (!updatePayload.password) {
          delete updatePayload.password;
        }
        saved = await onUpdateUser(editUser.id, updatePayload);
      } else {
        saved = await onAddUser(payload);
      }

      if (!saved) return;

      setShowForm(false);
      setEditUser(null);
    } catch (err) {
      setFormError(err.message || "Unable to save this user.");
      focusFormError(form);
    } finally {
      setIsSaving(false);
    }
  };

  const openForm = (user = null) => {
    setFormError("");
    setInvalidFields([]);
    const defaultOfficeId = offices[0]?.id || "";
    const excludeUserId = user?.id || null;
    if (user) {
      setEditUser(user);
      setFormData({
        username: user.username || "",
        password: "",
        fname: user.fname || "",
        lname: user.lname || "",
        mname: user.mname || "",
        role:
          user.role ||
          defaultRoleForOffice(
            user.officeId || defaultOfficeId,
            offices,
            users,
            excludeUserId,
          ),
        officeId: user.officeId || defaultOfficeId,
      });
    } else {
      setEditUser(null);
      setFormData({
        username: "",
        password: "",
        fname: "",
        lname: "",
        mname: "",
        role: defaultRoleForOffice(defaultOfficeId, offices, users),
        officeId: defaultOfficeId,
      });
    }
    setShowForm(true);
  };

  return (
    <>
      <PageShell
        header={
          <div className="page-header">
            <div className="page-header-left">
              <h1>User Management</h1>
              <p>Manage system users and their access levels</p>
            </div>
            <div className="page-header-actions page-header-actions--inline page-header-actions--mobile-only">
              <button className="btn btn-primary" onClick={() => openForm()}>
                <Plus size={16} /> New User
              </button>
            </div>
          </div>
        }
        toolbar={
          <div className="page-toolbar-row">
            <div className="filter-dropdown filter-dropdown-search">
              <label htmlFor={`${formId}-search`}>Search</label>
              <div className="search-bar document-search-bar">
                <Search size={16} color="var(--text-muted)" />
                <input id={`${formId}-search`}
                  type="text"
                  placeholder="Search by name, username, role, or office..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="page-toolbar-actions page-toolbar-actions--desktop-only">
              <button className="btn btn-primary" onClick={() => openForm()}>
                <Plus size={16} /> New User
              </button>
            </div>
          </div>
        }
      >
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>ID</th>
              <th>Role</th>
              <th>Office</th>
              <th>Username</th>
              <th style={{ textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedUsers.map((u) => {
              const normalizedRole = u.role;
              const rc = roleColors[normalizedRole] || roleColors.Receptionist;
              return (
                <tr key={u.id}>
                  <td>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                      }}
                    >
                      <div className="user-avatar">
                        {u.fname?.[0] || "?"}
                        {u.lname?.[0] || ""}
                      </div>
                      <div>
                        <div className="td-primary">
                          {u.fname} {u.mname} {u.lname}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="td-mono">{u.id}</span>
                  </td>
                  <td>
                    <span
                      style={{
                        padding: "0.2rem 0.6rem",
                        borderRadius: "9999px",
                        fontSize: "0.7rem",
                        fontWeight: 600,
                        background: rc.bg,
                        color: rc.color,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                      }}
                    >
                      {rc.icon}
                      {normalizedRole}
                    </span>
                  </td>
                  <td>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.375rem",
                        color: "var(--text-secondary)",
                      }}
                    >
                      <Building2
                        size={14}
                        style={{ color: "var(--text-muted)" }}
                      />
                      {getOfficeName(u.officeId)}
                    </div>
                  </td>
                  <td>
                    <span className="td-mono" style={{ fontSize: "0.78rem" }}>
                      {u.username || "—"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: "0.375rem",
                      }}
                    >
                      <button
                        className="btn-icon"
                        title="Edit"
                        onClick={() => openForm(u)}
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        className="btn-icon"
                        title="Delete"
                        onClick={() => onDeleteUser(u.id)}
                        style={{ color: "var(--danger)" }}
                        aria-label={`Delete ${u.fname} ${u.lname}`}
                      >
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
              onChange={(e) =>
                handlePageSizeChange(Number(e.target.value) || 1)
              }
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
          <span>
            Page {page} of {totalPages}
          </span>
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
      </PageShell>

      {showForm && (
        <ModalOverlay aria-labelledby={`${formId}-form-title`} onClose={closeForm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id={`${formId}-form-title`}>{editUser ? "Edit User" : "New User"}</h2>
              <button
                className="btn-icon"
                aria-label="Close user form"
                onClick={closeForm}
                disabled={isSaving}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} aria-describedby={formError ? `${formId}-form-error` : undefined}>
              <div className="modal-body">
                {formError && (
                  <div id={`${formId}-form-error`} data-form-error tabIndex={-1} role="alert"
                    style={{
                      marginBottom: "1rem",
                      padding: "0.75rem 1rem",
                      borderRadius: "var(--radius-md)",
                      background: "var(--danger-bg)",
                      color: "var(--danger)",
                      border: "1px solid rgba(239, 68, 68, 0.2)",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                    }}
                  >
                    {formError}
                  </div>
                )}
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor={`${formId}-first-name`} className="form-label">First Name *</label>
                    <input id={`${formId}-first-name`} aria-invalid={invalidFields.includes("fname")} aria-describedby={`${formId}-first-name-hint${invalidFields.includes("fname") ? ` ${formId}-form-error` : ''}`}
                      className="form-input"
                      type="text"
                      value={formData.fname}
                      onChange={(e) =>
                        setFormData({ ...formData, fname: e.target.value })
                      }
                      required
                    />
                    <p id={`${formId}-first-name-hint`} className="field-hint">
                      Given name shown in user lists and activity logs.
                    </p>
                  </div>
                  <div className="form-group">
                    <label htmlFor={`${formId}-last-name`} className="form-label">Last Name *</label>
                    <input id={`${formId}-last-name`} aria-invalid={invalidFields.includes("lname")} aria-describedby={`${formId}-last-name-hint${invalidFields.includes("lname") ? ` ${formId}-form-error` : ''}`}
                      className="form-input"
                      type="text"
                      value={formData.lname}
                      onChange={(e) =>
                        setFormData({ ...formData, lname: e.target.value })
                      }
                      required
                    />
                    <p id={`${formId}-last-name-hint`} className="field-hint">
                      Family name used for sorting users and reports.
                    </p>
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor={`${formId}-middle-name`} className="form-label">Middle Name</label>
                  <input id={`${formId}-middle-name`} aria-describedby={`${formId}-middle-name-hint`}
                    className="form-input"
                    type="text"
                    value={formData.mname}
                    onChange={(e) =>
                      setFormData({ ...formData, mname: e.target.value })
                    }
                  />
                  <p id={`${formId}-middle-name-hint`} className="field-hint">
                    Optional middle name or initial for complete records.
                  </p>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor={`${formId}-office`} className="form-label">Assigned Office</label>
                    <select id={`${formId}-office`} aria-invalid={invalidFields.includes("officeId")} aria-describedby={`${formId}-office-hint${invalidFields.includes("officeId") ? ` ${formId}-form-error` : ''}`}
                      className="form-select"
                      value={formData.officeId}
                      onChange={(e) => handleOfficeChange(e.target.value)}
                    >
                      {offices.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                    <p id={`${formId}-office-hint`} className="field-hint">
                      Choose the office first. Available roles depend on this
                      selection.
                    </p>
                  </div>
                  <div className="form-group">
                    <label htmlFor={`${formId}-role`} className="form-label">Role</label>
                    <select id={`${formId}-role`} aria-invalid={invalidFields.includes("role")} aria-describedby={`${formId}-role-hint${invalidFields.includes("role") ? ` ${formId}-form-error` : ''}`}
                      className="form-select"
                      value={formData.role}
                      onChange={(e) =>
                        setFormData({ ...formData, role: e.target.value })
                      }
                      disabled={availableRoles.length === 0}
                    >
                      {availableRoles.length === 0 ? (
                        <option value="">No roles available</option>
                      ) : (
                        availableRoles.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))
                      )}
                    </select>
                    <p id={`${formId}-role-hint`} className="field-hint">
                      {ROLE_HINTS[formData.role] ||
                        "Controls the dashboards, actions, and reports this user can access."}
                    </p>
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label htmlFor={`${formId}-username`} className="form-label">Username *</label>
                    <input id={`${formId}-username`} aria-invalid={invalidFields.includes("username")} aria-describedby={`${formId}-username-hint${invalidFields.includes("username") ? ` ${formId}-form-error` : ''}`}
                      className="form-input"
                      type="text"
                      value={formData.username}
                      onChange={(e) =>
                        setFormData({ ...formData, username: e.target.value })
                      }
                      required
                    />
                    <p id={`${formId}-username-hint`} className="field-hint">
                      The sign-in name this user enters on the login screen.
                    </p>
                  </div>
                  <div className="form-group">
                    <label htmlFor={`${formId}-password`} className="form-label">
                      {editUser ? "Password" : "Password *"}
                    </label>
                    <input id={`${formId}-password`} aria-invalid={invalidFields.includes("password")} aria-describedby={`${formId}-password-hint${invalidFields.includes("password") ? ` ${formId}-form-error` : ''}`}
                      className="form-input"
                      type="password"
                      value={formData.password}
                      onChange={(e) =>
                        setFormData({ ...formData, password: e.target.value })
                      }
                      placeholder={
                        editUser ? "Leave blank to keep current password" : ""
                      }
                      required={!editUser}
                    />
                    <p id={`${formId}-password-hint`} className="field-hint">
                      {editUser
                        ? "Leave blank to keep the current password."
                        : "Temporary password for the new account sign-in."}
                    </p>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeForm}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSaving || availableRoles.length === 0}
                >
                  {isSaving
                    ? "Saving..."
                    : editUser
                      ? "Update User"
                      : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}
    </>
  );
};

export default UserList;
