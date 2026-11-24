import LoadingSkeleton from './LoadingSkeleton';
import React from 'react';

const names = { documentTypes: 'Document types', deviceEvents: 'Device events', senderNotifications: 'Sender notifications' };
export default function DataSectionStatus({ keysToShow, states, onRetry }) {
  const pending = keysToShow.filter((key) => states[key]?.status !== 'ready');
  if (!pending.length) return null;
  const failures = pending.filter(key => states[key]?.status === 'error');
  const firstLoad = pending.some(key => key !== 'notifications' && !states[key]?.hasLoaded && states[key]?.status !== 'error');
  return <div className="data-section-status">
    {pending.length > failures.length && <span className="section-loading" role="status">{firstLoad ? <><LoadingSkeleton compact />Loading data…</> : 'Updating data…'}</span>}
    {failures.map(key => {
      const label = names[key] || key.charAt(0).toUpperCase() + key.slice(1);
      return <div key={key} className="section-load-error">
        <span role="alert"><strong>{label}</strong> · {states[key].error || 'Could not load data.'} Displayed records may be out of date.</span>
        <button type="button" className="btn btn-secondary btn-sm" aria-label={`Retry ${label}`} onClick={() => onRetry(key)}>Retry</button>
      </div>;
    })}
  </div>;
}
