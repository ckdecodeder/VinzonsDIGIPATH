import React from 'react';

const PageShell = ({ header, toolbar, children, className = '' }) => (
  <div className={className ? `page-layout ${className}` : 'page-layout'}>
    {(header || toolbar) && (
      <div className="page-top">
        {header}
        {toolbar ? <div className="page-toolbar-zone">{toolbar}</div> : null}
      </div>
    )}
    <div className="page-body">{children}</div>
  </div>
);

export default PageShell;
