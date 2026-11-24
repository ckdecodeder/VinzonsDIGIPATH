import React from 'react';

export default function LoadingSkeleton({ compact = false }) {
  return <span aria-hidden="true" className={compact ? 'loading-skeleton loading-skeleton--compact' : 'loading-skeleton'}>
    <span /><span /><span />
  </span>;
}
