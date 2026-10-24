import React, { useState } from 'react';
import PageShell from '../components/PageShell';
import ModalOverlay from '../components/ModalOverlay';
import { Search, Plus, Edit2, Trash2, X, Shield, ArrowRight } from 'lucide-react';

const ROUTING_TRACKS = [
  { value: 'direct', label: 'Direct', description: 'Office A → Office B' },
  { value: 'mayor', label: 'Mayor-Required', description: 'Office A → Mayor → Office B' },
  { value: 'sequential', label: 'Sequential', description: 'Multi-office chain' },
];

const DocumentTypeList = ({
  documentTypes = [],
  documents = [],
  onAddDocumentType,
  onUpdateDocumentType,
  onDeleteDocumentType,
}) => {
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editType, setEditType] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState({
    category: '',
    requiresMayorApproval: false,
    requiresMayorReception: false,
    routingTrack: 'direct',
  });

  const filtered = documentTypes.filter((t) =>
    t.category?.toLowerCase().includes(search.toLowerCase()),
  );

  const openForm = (type = null) => {
    if (type) {
      setEditType(type);
      setFormData({
        category: type.category || '',
        requiresMayorApproval: Boolean(type.requiresMayorApproval),
        requiresMayorReception: Boolean(type.requiresMayorReception),
        routingTrack: type.routingTrack || 'direct',
      });
    } else {
      setEditType(null);
      setFormData({ category: '', requiresMayorApproval: false, requiresMayorReception: false, routingTrack: 'direct' });
    }
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const saved = editType
        ? await onUpdateDocumentType(editType.id, formData)
        : await onAddDocumentType(formData);
      if (!saved) return;
      setShowForm(false);
      setEditType(null);
    } finally {
      setIsSaving(false);
    }
  };

  const getTrackInfo = (track) => ROUTING_TRACKS.find((t) => t.value === track) || ROUTING_TRACKS[0];

  const getDocumentCount = (typeId) => documents.filter((d) => d.documentTypeId === typeId).length;

  return (
    <>
      <PageShell
        header={
          <div className="page-header">
            <div className="page-header-left">
              <h1>Document Types</h1>
              <p>Configure document categories and their routing behavior</p>
            </div>
            <div className="page-header-actions page-header-actions--inline page-header-actions--mobile-only">
              <button className="btn btn-primary" onClick={() => openForm()}>
                <Plus size={16} /> New Type
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
                  placeholder="Search document types..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="page-toolbar-actions page-toolbar-actions--desktop-only">
              <button className="btn btn-primary" onClick={() => openForm()}>
                <Plus size={16} /> New Type
              </button>
            </div>
          </div>
        }
      >
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Routing Track</th>
                <th style={{ textAlign: 'center' }}>Mayor Approval</th>
                <th style={{ textAlign: 'center' }}>Mayor Reception</th>
                <th style={{ textAlign: 'center' }}>Documents</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                    No document types found.
                  </td>
                </tr>
              ) : (
                filtered.map((type) => {
                  const track = getTrackInfo(type.routingTrack);
                  const docCount = getDocumentCount(type.id);
                  return (
                    <tr key={type.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{type.category}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{type.id}</div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <ArrowRight size={14} color="var(--text-muted)" />
                          <span>{track.label}</span>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{track.description}</div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {type.requiresMayorApproval ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                            background: 'color-mix(in srgb, var(--warning) 12%, transparent)',
                            color: 'var(--warning)', borderRadius: '999px',
                            padding: '0.2rem 0.6rem', fontSize: '0.75rem', fontWeight: 600,
                          }}>
                            <Shield size={12} /> Required
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center' }}>{type.requiresMayorReception ? 'Required' : '—'}</td>
                      <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{docCount}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button className="btn btn-sm btn-secondary" onClick={() => openForm(type)}>
                            <Edit2 size={14} />
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => onDeleteDocumentType(type.id)}
                            disabled={docCount > 0}
                            title={docCount > 0 ? 'Cannot delete: type is in use by documents' : 'Delete'}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </PageShell>

      {showForm && (
        <ModalOverlay onClose={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editType ? 'Edit Document Type' : 'New Document Type'}</h2>
              <button className="btn-icon" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1.5rem' }}>
                {/* Category */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Category Name <span className="required">*</span></label>
                  <input
                    className="form-input"
                    type="text"
                    required
                    value={formData.category}
                    onChange={(e) => setFormData((p) => ({ ...p, category: e.target.value }))}
                    placeholder="e.g. Memorandum, Executive Order"
                  />
                </div>

                {/* Routing Track */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Routing Track</label>
                  <select
                    className="form-input"
                    value={formData.routingTrack}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFormData((p) => ({
                        ...p,
                        routingTrack: val,
                        requiresMayorApproval: val === 'mayor' ? true : p.requiresMayorApproval,
                      }));
                    }}
                  >
                    {ROUTING_TRACKS.map((t) => (
                      <option key={t.value} value={t.value}>{t.label} — {t.description}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', marginBottom: 0 }}>
                  <div style={{ flex: 1, paddingRight: '1rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.25rem', color: 'var(--text-main)' }}>Initial reception at Mayor’s Office</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>Route the document to the Mayor’s Office reception before other offices.</div>
                  </div>
                  <input type="checkbox" checked={formData.requiresMayorReception} onChange={(e) => setFormData((p) => ({ ...p, requiresMayorReception: e.target.checked }))} />
                </div>

                {/* Mayor Approval Toggle */}
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', marginBottom: 0 }}>
                  <div style={{ flex: 1, paddingRight: '1rem' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.25rem', color: 'var(--text-main)' }}>Requires Mayor Approval</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                      Document will be automatically routed to Mayor's Office before going to its destination
                    </div>
                  </div>
                  <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px', flexShrink: 0, margin: 0 }}>
                    <input
                      type="checkbox"
                      style={{ opacity: 0, width: 0, height: 0, margin: 0 }}
                      checked={formData.requiresMayorApproval}
                      onChange={(e) => setFormData((p) => ({ ...p, requiresMayorApproval: e.target.checked }))}
                    />
                    <span style={{
                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                      background: formData.requiresMayorApproval ? 'var(--primary)' : 'var(--border)',
                      borderRadius: '24px', transition: 'background 0.2s',
                    }}>
                      <span style={{
                        position: 'absolute', content: '""', height: '18px', width: '18px',
                        left: formData.requiresMayorApproval ? '23px' : '3px', bottom: '3px',
                        background: 'white', borderRadius: '50%', transition: 'left 0.2s',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                      }} />
                    </span>
                  </label>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSaving}>
                  {isSaving ? 'Saving...' : (editType ? 'Save Changes' : 'Create Type')}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>
      )}
    </>
  );
};

export default DocumentTypeList;
