import React, { useState } from "react";
import PageShell from "../components/PageShell";
import ModalOverlay from "../components/ModalOverlay";
import { Building2, Users, Search, Plus, X, Edit2, Trash2 } from "lucide-react";

const OfficeList = ({
  offices,
  users,
  documents,
  transmissions,
  onAddOffice,
  onUpdateOffice,
  onDeleteOffice,
}) => {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editOffice, setEditOffice] = useState(null);

  const [formData, setFormData] = useState({
    name: "",
  });
  const [isSaving, setIsSaving] = useState(false);

  const filteredOffices = offices.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const saved = editOffice
        ? await onUpdateOffice(editOffice.id, formData)
        : await onAddOffice(formData);

      if (!saved) return;

      setShowForm(false);
      setEditOffice(null);
    } finally {
      setIsSaving(false);
    }
  };

  const openForm = (office = null) => {
    if (office) {
      setEditOffice(office);
      setFormData({ name: office.name });
    } else {
      setEditOffice(null);
      setFormData({ name: "" });
    }
    setShowForm(true);
  };

  return (
    <>
      <PageShell
        header={
          <div className="page-header">
            <div className="page-header-left">
              <h1>Offices</h1>
              <p>All registered offices in the municipal system</p>
            </div>
          </div>
        }
        toolbar={
          <div className="page-toolbar-row">
            <div className="filter-dropdown filter-dropdown-search">
              <label>Search</label>
              <div className="search-bar document-search-bar">
                <Search size={16} color="var(--text-muted)" />
                <input
                  type="text"
                  placeholder="Search offices..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <button className="btn btn-primary" onClick={() => openForm()}>
              <Plus size={16} /> New Office
            </button>
          </div>
        }
      >
      <div className="device-grid">
        {filteredOffices.map((office) => {
          const officeUsers = users.filter((u) => u.officeId === office.id);
          const outgoing = transmissions.filter(
            (t) => t.fromOfficeId === office.id,
          ).length;
          const incoming = transmissions.filter(
            (t) => t.toOfficeId === office.id,
          ).length;

          return (
            <div
              key={office.id}
              className="device-card"
              style={{ display: "flex", flexDirection: "column" }}
            >
              <div className="device-card-header">
                <div
                  className="device-icon-wrapper"
                  style={{ background: "var(--primary-glow)" }}
                >
                  <Building2
                    size={22}
                    style={{ color: "var(--primary-light)" }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                  }}
                >
                  <span className="td-mono" style={{ fontSize: "0.7rem" }}>
                    {office.id}
                  </span>
                  <button
                    className="btn-icon"
                    style={{ padding: "0.2rem" }}
                    onClick={() => openForm(office)}
                  >
                    <Edit2 size={12} />
                  </button>
                  <button
                    className="btn-icon"
                    style={{ padding: "0.2rem", color: "var(--danger)" }}
                    onClick={() => onDeleteOffice(office.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <div className="device-name">{office.name}</div>
              <div
                className="device-meta"
                style={{ marginTop: "0.75rem", flex: 1 }}
              >
                <div className="device-meta-row">
                  <span className="device-meta-label">
                    <Users
                      size={13}
                      style={{
                        marginRight: "0.375rem",
                        verticalAlign: "middle",
                      }}
                    />
                    Staff
                  </span>
                  <span className="device-meta-value">
                    {officeUsers.length} members
                  </span>
                </div>
                <div className="device-meta-row">
                  <span className="device-meta-label">Sent</span>
                  <span className="device-meta-value">{outgoing}</span>
                </div>
                <div className="device-meta-row">
                  <span className="device-meta-label">Received</span>
                  <span className="device-meta-value">{incoming}</span>
                </div>
              </div>
              {officeUsers.length > 0 && (
                <div
                  className="device-actions"
                  style={{
                    flexDirection: "column",
                    gap: "0.375rem",
                    marginTop: "1rem",
                  }}
                >
                  {officeUsers.map((u) => (
                    <div
                      key={u.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        fontSize: "0.78rem",
                      }}
                    >
                      <div
                        className="user-avatar"
                        style={{
                          width: "24px",
                          height: "24px",
                          fontSize: "0.6rem",
                        }}
                      >
                        {u.fname[0]}
                        {u.lname[0]}
                      </div>
                      <span style={{ color: "var(--text-secondary)" }}>
                        {u.fname} {u.lname}
                      </span>
                      <span
                        style={{
                          marginLeft: "auto",
                          color: "var(--text-muted)",
                          fontSize: "0.7rem",
                        }}
                      >
                        {u.role}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      </PageShell>

      {showForm && (
        <ModalOverlay onClose={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editOffice ? "Edit Office" : "New Office"}</h2>
              <button className="btn-icon" onClick={() => setShowForm(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Office Name *</label>
                  <input
                    className="form-input"
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                  />
                  <p className="field-hint">
                    This name appears in routing, tracking, reports, and user
                    assignments.
                  </p>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSaving}>
                  {isSaving ? 'Saving...' : editOffice ? 'Update Office' : 'Create Office'}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}
    </>
  );
};

export default OfficeList;
