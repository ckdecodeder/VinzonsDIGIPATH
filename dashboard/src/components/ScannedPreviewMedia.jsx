import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import PdfFitPreview from './PdfFitPreview';
import { getAttachmentUrl } from '../utils/mediaUrl';
import { isImageAttachment, isPdfAttachment } from '../utils/documentFiles';

export default function ScannedPreviewMedia({ file }) {
  const blobUrlRef = useRef('');
  const [src, setSrc] = useState(() => getAttachmentUrl(file));
  const [error, setError] = useState('');

  useEffect(() => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = '';
    }
    setSrc(getAttachmentUrl(file));
    setError('');
  }, [file]);

  useEffect(() => () => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
    }
  }, []);

  const handleImageError = async () => {
    if (!src || error) return;

    try {
      const response = await fetch(src, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`File not found (${response.status})`);
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
      blobUrlRef.current = blobUrl;
      setSrc(blobUrl);
      setError('');
    } catch {
      setError('Unable to load this scanned file. It may be missing from the server — try downloading instead.');
    }
  };

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
      <img
        src={src}
        alt={file.name}
        className="scanned-preview-image"
        onError={handleImageError}
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
