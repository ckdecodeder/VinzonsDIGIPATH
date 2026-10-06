import React, { useState } from "react";
import PageShell from "../components/PageShell";
import ModalOverlay from "../components/ModalOverlay";
import {
  Building2,
  Users,
  Search,
  Plus,
  X,
  Edit2,
  Trash2,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";

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
            <div className="page-header-actions page-header-actions--inline page-header-actions--mobile-only">
              <button className="btn btn-primary" onClick={() => openForm()}>
                <Plus size={16} /> New Office
              </button>
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
            <div className="page-toolbar-actions page-toolbar-actions--desktop-only">
              <button className="btn btn-primary" onClick={() => openForm()}>
                <Plus size={16} /> New Office
              </button>
            </div>
          </div>
        }
      >
        <div className="office-page">
          <p className="office-page-summary">
            Showing {filteredOffices.length} of {offices.length} offices
          </p>

          {filteredOffices.length === 0 ? (
            <div className="empty-state office-empty-state">
              <div className="empty-state-icon">
                <Building2 size={24} color="var(--text-muted)" />
              </div>
              <h3>No offices found</h3>
              <p>
                {search
                  ? "Try a different search term or clear the filter."
                  : "Create the first office to start assigning staff and routing documents."}
              </p>
            </div>
          ) : (
            <div className="office-grid">
              {filteredOffices.map((office) => {
                const officeUsers = users.filter(
                  (u) => u.officeId === office.id,
                );
                const outgoing = transmissions.filter(
                  (t) => t.fromOfficeId === office.id,
                ).length;
                const incoming = transmissions.filter(
                  (t) => t.toOfficeId === office.id,
                ).length;
                const visibleStaff = officeUsers.slice(0, 4);
                const hiddenStaffCount = Math.max(
                  officeUsers.length - visibleStaff.length,
                  0,
                );

                return (
                  <article key={office.id} className="office-card">
                    <div className="office-card-top">
                      <div className="office-card-icon">
                        <Building2 size={20} />
                      </div>
                      <div className="office-card-actions">
                        <span className="office-card-id td-mono">
                          {office.id}
                        </span>
                        <button
                          type="button"
                          className="btn-icon"
                          title="Edit office"
                          onClick={() => openForm(office)}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon office-card-delete"
                          title="Delete office"
                          onClick={() => onDeleteOffice(office.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <h2 className="office-card-name">{office.name}</h2>

                    <div className="office-card-stats">
                      <div className="office-stat">
                        <Users size={13} />
                        <span>{officeUsers.length} staff</span>
                      </div>
                      <div className="office-stat">
                        <ArrowUpRight size={13} />
                        <span>{outgoing} sent</span>
                      </div>
                      <div className="office-stat">
                        <ArrowDownLeft size={13} />
                        <span>{incoming} received</span>
                      </div>
                    </div>

                    {officeUsers.length > 0 && (
                      <div className="office-staff">
                        <div className="office-staff-label">Assigned staff</div>
                        <ul className="office-staff-list">
                          {visibleStaff.map((u) => (
                            <li key={u.id} className="office-staff-row">
                              <div className="office-staff-avatar user-avatar">
                                {u.fname?.[0] || "?"}
                                {u.lname?.[0] || ""}
                              </div>
                              <span className="office-staff-name">
                                {u.fname} {u.lname}
                              </span>
                              <span className="office-staff-role">{u.role}</span>
                            </li>
                          ))}
                        </ul>
                        {hiddenStaffCount > 0 && (
                          <p className="office-staff-more">
                            +{hiddenStaffCount} more staff member
                            {hiddenStaffCount === 1 ? "" : "s"}
                          </p>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
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
