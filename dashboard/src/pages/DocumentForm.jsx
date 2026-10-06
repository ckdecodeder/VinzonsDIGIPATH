import React, { useState } from 'react';

const DocumentForm = ({ onCancel, onSubmit, editDoc }) => {
  const [formData, setFormData] = useState(editDoc || {
    title: '',
    category: 'Memorandum',
    date: new Date().toISOString().split('T')[0],
    status: 'Draft',
    author: 'Admin'
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <div className="card" style={{ maxWidth: '800px', margin: '0 auto' }}>
      <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '700' }}>{editDoc ? 'Edit Document' : 'Create New Document'}</h2>
      
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label className="form-label">Document Title</label>
          <input 
            type="text" 
            value={formData.title}
            onChange={(e) => setFormData({...formData, title: e.target.value})}
            placeholder="Enter title" 
            className="form-input"
            required
          />
          <p className="field-hint">Short title used to identify the document in lists.</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label className="form-label">Category</label>
            <select 
              value={formData.category}
              onChange={(e) => setFormData({...formData, category: e.target.value})}
              className="form-select"
            >
              <option>Memorandum</option>
              <option>Executive Order</option>
              <option>Communication Letter</option>
              <option>Proposal</option>
            </select>
            <p className="field-hint">Groups the document under the correct report category.</p>
          </div>
          <div>
            <label className="form-label">Date</label>
            <input 
              type="date" 
              value={formData.date}
              onChange={(e) => setFormData({...formData, date: e.target.value})}
              className="form-input"
              required
            />
            <p className="field-hint">Date associated with this document record.</p>
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label className="form-label">Status</label>
          <select 
            value={formData.status}
            onChange={(e) => setFormData({...formData, status: e.target.value})}
            className="form-select"
          >
            <option>Draft</option>
            <option>Pending</option>
            <option>Approved</option>
          </select>
          <p className="field-hint">Current workflow state for the draft document.</p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary">{editDoc ? 'Update Document' : 'Save Document'}</button>
        </div>
      </form>
    </div>
  );
};

export default DocumentForm;
