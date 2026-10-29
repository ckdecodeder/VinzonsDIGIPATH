import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import PdfFitPreview from './PdfFitPreview';
import ProtectedImage from './ProtectedImage';
import { getAttachmentUrl } from '../utils/mediaUrl';
import { isImageAttachment, isPdfAttachment } from '../utils/documentFiles';

export default function ScannedPreviewMedia({ file }) {
  const src = getAttachmentUrl(file);
  const [error, setError] = useState('');
  useEffect(() => setError(''), [file]);

  if (isImageAttachment(file)) {
    if (error) {
      return (
        <div className="scanned-preview-error">
          <FileText size={28} />
          <h3>Preview unavailable</h3>
          <p>{error}</p>
        </div>
      );
    }

    return (
      <ProtectedImage
        src={src}
        alt={file.name}
        className="scanned-preview-image"
        onError={() => setError('Unable to load this scanned file. Reopen it to retry.')}
      />
    );
  }

  if (isPdfAttachment(file)) {
    return (
      <PdfFitPreview
        src={src}
        alt={file.name}
      />
    );
  }

  return (
    <div className="empty-state" style={{ padding: '2rem' }}>
      <FileText size={28} />
      <h3>Preview unavailable</h3>
      <p>This file type can be downloaded but cannot be previewed in the browser.</p>
    </div>
  );
}
