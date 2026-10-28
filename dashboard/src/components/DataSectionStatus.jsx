import React from 'react';

const names = { documentTypes: 'Document types', deviceEvents: 'Device events', senderNotifications: 'Sender notifications' };
export default function DataSectionStatus({ keysToShow, states, onRetry }) {
  const pending = keysToShow.filter((key) => states[key]?.status !== 'ready');
  if (!pending.length) return null;
  return <div aria-live="polite" style={{ marginBottom: '1rem' }}>
    {pending.map((key) => {
      const failed = states[key]?.status === 'error';
      return <div key={key} role={failed ? 'alert' : 'status'} style={{ padding: '0.4rem 0', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <span><strong>{names[key] || key.charAt(0).toUpperCase() + key.slice(1)}:</strong>{' '}
          {failed ? states[key].error : 'Loading…'} Counts and results for this section are unavailable until loaded.</span>
        {failed && <button className="btn btn-secondary btn-sm" onClick={() => onRetry(key)}>Retry</button>}
      </div>;
    })}
  </div>;
}
