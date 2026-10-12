import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  X,
  Maximize2,
  Minimize2,
  Download,
  RotateCw,
  Check,
  FileText,
  Trash2,
} from 'lucide-react';
import ModalOverlay from './ModalOverlay';
import PdfFitPreview from './PdfFitPreview';
import {
  downloadAttachment,
  getAttachmentSource,
  isImageAttachment,
  isPdfAttachment,
  rotateImageAttachment,
} from '../utils/attachmentDownload';

const computeImageFit = (naturalWidth, naturalHeight, rotation, containerWidth, containerHeight) => {
  if (!naturalWidth || !naturalHeight || !containerWidth || !containerHeight) {
    return { width: null, height: null, stageWidth: null, stageHeight: null };
  }

  const sideways = rotation % 180 !== 0;
  const boundsWidth = sideways ? naturalHeight : naturalWidth;
  const boundsHeight = sideways ? naturalWidth : naturalHeight;
  const scale = Math.min(
    containerWidth / boundsWidth,
    containerHeight / boundsHeight,
    1,
  );

  const width = Math.round(naturalWidth * scale);
  const height = Math.round(naturalHeight * scale);

  return {
    width,
    height,
    stageWidth: sideways ? height : width,
    stageHeight: sideways ? width : height,
  };
};

const ScannedPreviewModal = ({
  file,
  canEdit = false,
  onClose,
  onSaveRotated,
  onRemove,
  onSaved,
  onNotify,
}) => {
  const surfaceRef = useRef(null);
  const modalBodyRef = useRef(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState('original');
  const [previewRotation, setPreviewRotation] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [fitSize, setFitSize] = useState({
    width: null,
    height: null,
    stageWidth: null,
    stageHeight: null,
  });

  useEffect(() => {
    setPreviewRotation(0);
    setDownloadFormat('original');
    setIsMaximized(false);
    setNaturalSize({ width: 0, height: 0 });
    setFitSize({
      width: null,
      height: null,
      stageWidth: null,
      stageHeight: null,
    });
  }, [file?.id, file?.url, file?.dataUrl]);

  const recomputeFit = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface || !naturalSize.width || !naturalSize.height) return;

    const rect = surface.getBoundingClientRect();
    const styles = window.getComputedStyle(surface);
    const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const availableWidth = Math.max(rect.width - padX, 1);
    const availableHeight = Math.max(rect.height - padY, 1);

    setFitSize(computeImageFit(
      naturalSize.width,
      naturalSize.height,
      previewRotation,
      availableWidth,
      availableHeight,
    ));
  }, [naturalSize.height, naturalSize.width, previewRotation]);

  const handleImageLoad = (event) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    setNaturalSize({ width: naturalWidth, height: naturalHeight });

    const surface = surfaceRef.current;
    if (!surface) return;

    const rect = surface.getBoundingClientRect();
    const styles = window.getComputedStyle(surface);
    const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const availableWidth = Math.max(rect.width - padX, 1);
    const availableHeight = Math.max(rect.height - padY, 1);

    setFitSize(computeImageFit(
      naturalWidth,
      naturalHeight,
      previewRotation,
      availableWidth,
      availableHeight,
    ));
  };

  useLayoutEffect(() => {
    recomputeFit();
  }, [recomputeFit, isMaximized]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;

    const observer = new ResizeObserver(() => {
      recomputeFit();
    });
    observer.observe(surface);
    if (modalBodyRef.current) {
      observer.observe(modalBodyRef.current);
    }

    return () => observer.disconnect();
  }, [recomputeFit, isMaximized]);

  useEffect(() => {
    window.addEventListener('resize', recomputeFit);
    return () => window.removeEventListener('resize', recomputeFit);
  }, [recomputeFit]);

  if (!file) return null;

  const isImage = isImageAttachment(file);
  const isPdf = isPdfAttachment(file);
  const hasRotation = previewRotation % 360 !== 0;
  const isImageReady = Boolean(fitSize.width && fitSize.height);

  const closePreview = () => {
    setIsMaximized(false);
    setPreviewRotation(0);
    onClose?.();
  };

  const rotatePreview = () => {
    setPreviewRotation((prev) => (prev + 90) % 360);
  };

  const handleDownload = async () => {
    try {
      await downloadAttachment(file, downloadFormat);
    } catch (err) {
      onNotify?.({
        type: 'danger',
        title: 'Download failed',
        message: err.message || 'Unable to download this scanned file.',
      });
    }
  };

  const handleSaveRotation = async () => {
    if (!hasRotation || !onSaveRotated) return;
    setIsSaving(true);
    try {
      const rotated = await rotateImageAttachment(file, previewRotation);
      await onSaveRotated(rotated);
      setPreviewRotation(0);
      onSaved?.();
    } catch (err) {
      onNotify?.({
        type: 'danger',
        title: 'Save failed',
        message: err.message || 'Unable to save the rotated scan.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalOverlay
      overlayClassName="scanned-preview-overlay"
      onClose={closePreview}
    >
      <div
        className={`modal scanned-preview-modal ${isMaximized ? 'maximized' : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>Scanned Paper Preview</h2>
            <p className="scanned-preview-filename">{file.name}</p>
          </div>
          <div className="scanned-preview-header-actions">
            <button
              type="button"
              className="btn-icon"
              onClick={() => setIsMaximized((prev) => !prev)}
              title={isMaximized ? 'Restore preview' : 'Maximize preview'}
            >
              {isMaximized ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button type="button" className="btn-icon" onClick={closePreview}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal-body" ref={modalBodyRef}>
          <div className="scanned-preview-surface" ref={surfaceRef}>
            {isImage ? (
              <div
                className="scanned-preview-stage"
                style={{
                  width: fitSize.stageWidth ? `${fitSize.stageWidth}px` : '100%',
                  height: fitSize.stageHeight ? `${fitSize.stageHeight}px` : '100%',
                }}
              >
                <img
                  src={getAttachmentSource(file)}
                  alt={file.name}
                  className={`scanned-preview-image ${isImageReady ? 'is-ready' : ''}`}
                  onLoad={handleImageLoad}
                  style={{
                    width: fitSize.width ? `${fitSize.width}px` : undefined,
                    height: fitSize.height ? `${fitSize.height}px` : undefined,
                    transform: `rotate(${previewRotation}deg)`,
                  }}
                />
              </div>
            ) : isPdf ? (
              <div className="scanned-preview-pdf-scroll">
                <PdfFitPreview src={getAttachmentSource(file)} alt={file.name} allPages />
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <FileText size={28} />
                <h3>Preview unavailable</h3>
                <p>This file type can be downloaded but cannot be previewed in the browser.</p>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer scanned-preview-footer">
          <select
            className="form-select preview-format-select"
            value={downloadFormat}
            onChange={(event) => setDownloadFormat(event.target.value)}
          >
            <option value="original">Original</option>
            <option value="pdf">PDF</option>
            <option value="png">PNG</option>
            <option value="jpeg">JPG</option>
          </select>
          <button type="button" onClick={handleDownload} className="btn btn-secondary">
            <Download size={16} />{' '}
            {downloadFormat === 'pdf'
              ? 'Download PDF'
              : downloadFormat === 'jpeg'
                ? 'Download JPEG'
                : downloadFormat === 'png'
                  ? 'Download PNG'
                  : 'Download'}
          </button>
          {isImage && canEdit && hasRotation && (
            <button
              type="button"
              className="btn btn-primary scanned-preview-save-rotation-btn"
              onClick={handleSaveRotation}
              disabled={isSaving}
            >
              <Check size={16} />
              {isSaving ? 'Saving...' : 'Save Rotation'}
            </button>
          )}
          {isImage && canEdit && (
            <button
              type="button"
              className={`btn btn-secondary scanned-preview-rotate-btn ${hasRotation ? 'is-active' : ''}`}
              onClick={rotatePreview}
              title="Rotate clockwise"
            >
              <RotateCw size={16} /> Rotate
            </button>
          )}
          {canEdit && onRemove && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={onRemove}
              title="Remove scanned file"
            >
              <Trash2 size={16} /> Remove
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsMaximized((prev) => !prev)}
          >
            {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            {isMaximized ? 'Restore' : 'Maximize'}
          </button>
          <button
            type="button"
            className={`btn ${hasRotation && isImage && canEdit ? 'btn-secondary' : 'btn-primary'}`}
            onClick={closePreview}
          >
            Done
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default ScannedPreviewModal;
