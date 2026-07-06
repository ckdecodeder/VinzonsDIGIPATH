import React from 'react';

const PageShell = ({ header, toolbar, children }) => (
  <div className="page-layout">
    {(header || toolbar) && (
      <div className="page-sticky-top">
        {header}
        {toolbar ? <div className="page-toolbar-zone">{toolbar}</div> : null}
      </div>
    )}
    <div className="page-scroll-area">{children}</div>
  </div>
);

export default PageShell;
