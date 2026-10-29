import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import PageShell from "./PageShell";
import PdfFitPreview from "./PdfFitPreview";
import ProtectedImage from './ProtectedImage';
import { readMediaBlob } from '../utils/protectedMedia';
import {
  Camera as CameraIcon,
  Scan,
  Loader2,
  Zap,
  ArrowRight,
  ArrowLeft,
  Send,
  FileText,
  Building2,
  CheckCircle2,
  AlertCircle,
  User,
  Phone,
  Mail,
  Flag,
  MessageSquare,
  Eye,
  Image as ImageIcon,
  Wifi,
  WifiOff,
  RefreshCw,
  RotateCw,
  XCircle,
  Lightbulb,
} from "lucide-react";
import { resolveUploadUrl, isPdfMedia } from "../utils/mediaUrl";
import { getReportedBridgeUrl, probeLanBridge, fetchLanSnapshotAny } from "../utils/bridgePreview";
import { commandService, bridgeService } from "../api/documentService";
import { toUserFacingError } from "../utils/userFacingError";
import { validateRequiredFields, clearFieldError } from "../utils/formValidation";
import { useOptionalRealtime } from "../context/RealtimeContext";
import { useLiveDevice } from "../hooks/useLiveDevice";
import {
  offices as defaultOffices,
  documentTypes as defaultDocumentTypes,
  priorityLevels,
  getPriorityInfo,
} from "../data/mockData";
import { getSortLayerHint, resolveSortLayer } from "../utils/sortLayer";
import { MAYORS_OFFICE_ID } from "../utils/userRoles";

const OTHER_OFFICE_VALUE = '__external_source__';
const PHYSICAL_CAMERA_VALUE = 'physical-scanner';

const paperGuides = [
  { id: 'letter-landscape', label: 'Letter', width: 11, height: 8.5, orientation: 'landscape' },
  { id: 'legal-landscape', label: 'Legal', width: 14, height: 8.5, orientation: 'landscape' },
  { id: 'a4-landscape', label: 'A4', width: 297, height: 210, orientation: 'landscape' },
  { id: 'id-card', label: 'ID / Card', width: 85.6, height: 53.98, orientation: 'landscape' },
  { id: 'letter-portrait', label: 'Portrait', width: 8.5, height: 11, orientation: 'portrait' },
];

const getPaperGuideLayout = (guide) => {
  const width = Number(guide?.width) || 11;
  const height = Number(guide?.height) || 8.5;
  const ratio = width / height;
  const orientation = guide?.orientation === 'portrait' ? 'portrait' : 'landscape';
  return {
    ratio,
    orientation,
    overlayClass: `scanner-paper-overlay--${orientation}`,
    frameClass: `scanner-paper-frame--${orientation}`,
    shellClass: `scanner-preview-shell--${orientation}`,
  };
};

const parseResolutionLabel = (value) => {
  const match = String(value || '').match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
};

const readJpegDimensions = (bytes) => {
  if (!bytes?.length || bytes.length < 4) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    offset += segmentLength;
  }
  return null;
};

const is2kResolution = ({ width, height }) => (
  width >= 2560 && height >= 1440
);

const getPreviewFitMode = () => 'contain';

const renderScannedDocumentPreview = (src, { alt = 'Scanned document', isPdf = false } = {}) => {
  if (!src) return null;
  const resolved = resolveUploadUrl(src);
  if (isPdf) {
    return <PdfFitPreview src={resolved} alt={alt} />;
  }
  return (
    <div className="scanner-scanned-preview-shell">
      <ProtectedImage src={resolved} alt={alt} className="scanner-scanned-preview-image" />
    </div>
  );
};

const MAX_SCAN_PDF_BYTES = 9 * 1024 * 1024;

const blobToDataUrl = (blob, errorMessage) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => (
    typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error(errorMessage))
  );
  reader.onerror = () => reject(reader.error || new Error(errorMessage));
  reader.readAsDataURL(blob);
});

const loadCapturedPage = async (file) => {
  const src = resolveUploadUrl(file?.dataUrl || file?.previewUrl || file?.url);
  if (!src) throw new Error('A captured page is missing its image URL.');

  const blob = await readMediaBlob(src);
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(`Unable to read captured page "${file.name || 'scan'}".`));
      image.src = objectUrl;
    });
    if (!blob.type.startsWith('image/')) {
      throw new Error(`Captured page "${file.name || 'scan'}" is not an image.`);
    }
    return {
      data: await blobToDataUrl(blob, `Unable to prepare captured page "${file.name || 'scan'}" for the PDF.`),
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const createScannedDocumentPdf = async (files, guide) => {
  if (!files.length) throw new Error('Capture at least one page before creating the PDF.');
  const pageWidth = guide.width <= 20 ? guide.width * 25.4 : guide.width;
  const pageHeight = guide.height <= 20 ? guide.height * 25.4 : guide.height;
  const orientation = pageWidth > pageHeight ? 'landscape' : 'portrait';
  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: [pageWidth, pageHeight],
    compress: true,
  });

  for (let index = 0; index < files.length; index += 1) {
    const page = await loadCapturedPage(files[index]);
    if (index > 0) pdf.addPage([pageWidth, pageHeight], orientation);
    const scale = Math.min(pageWidth / page.width, pageHeight / page.height);
    const width = page.width * scale;
    const height = page.height * scale;
    pdf.addImage(
      page.data,
      'JPEG',
      (pageWidth - width) / 2,
      (pageHeight - height) / 2,
      width,
      height,
      undefined,
      'FAST',
    );
  }

  const blob = pdf.output('blob');
  if (blob.size > MAX_SCAN_PDF_BYTES) {
    throw new Error('The combined PDF is larger than the 9 MB upload limit. Capture fewer pages or use a smaller scan resolution.');
  }
  const dataUrl = await blobToDataUrl(blob, 'Unable to prepare the combined PDF for upload.');
  return {
    id: `scan-pdf-${Date.now()}`,
    name: `scanned-document-${Date.now()}.pdf`,
    type: 'application/pdf',
    size: blob.size,
    dataUrl,
    source: 'scanner',
    uploadedAt: new Date().toISOString(),
  };
};

const paintWsFrameToCanvas = (canvas, frame, paintGenRef, onReady, options = {}) => {
  if (!canvas || !frame?.length) return;
  const fitMode = options.fitMode === 'cover' ? 'cover' : 'contain';
  const paintGen = (paintGenRef.current += 1);
  const blob = new Blob([frame], { type: 'image/jpeg' });

  const drawBitmap = (bitmap) => {
    if (paintGen !== paintGenRef.current) {
      bitmap.close?.();
      return;
    }
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      bitmap.close?.();
      return;
    }
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = fitMode === 'cover' ? 'high' : 'low';
    const scale = fitMode === 'cover'
      ? Math.max(cw / bitmap.width, ch / bitmap.height)
      : Math.min(cw / bitmap.width, ch / bitmap.height);
    const dw = bitmap.width * scale;
    const dh = bitmap.height * scale;
    ctx.drawImage(bitmap, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    bitmap.close?.();
    onReady?.();
  };

  if (typeof createImageBitmap === 'function') {
    createImageBitmap(blob, {
      premultiplyAlpha: 'none',
      resizeQuality: 'low',
    })
      .then(drawBitmap)
      .catch(() => {
        const img = new Image();
        img.onload = () => drawBitmap(img);
        img.onerror = () => {};
        img.src = URL.createObjectURL(blob);
      });
    return;
  }

  const img = new Image();
  img.onload = () => drawBitmap(img);
  img.src = URL.createObjectURL(blob);
};

const WS_STREAM_TIMEOUT_MS = 15000;
const STREAM_STALE_OVERLAY_MS = 90000;
const SNAPSHOT_POLL_MS = 3500;
// Same order as the camera's own colour button. Scene = what the Pi sends; mode = what the camera reports.
const CAMERA_LIGHT_SCENES = [
  { scene: 0, mode: 0 },
  { scene: 1, mode: 1 },
  { scene: 2, mode: 2 },
  { scene: 5, mode: 3 },
];
const deviceUsesWsJpegStream = (device) => (
  device?.payload?.streamMode === 'jpeg-ws'
  || device?.payload?.bridgeVersion === 'ws-jpeg-1.0'
  || device?.streamWsConnected === true
);

const getSubjectFromOcr = (text, fallback = '') => {
  const normalizedFallback = (fallback || '').trim();
  if (
    normalizedFallback
    && !/^scanned document$/i.test(normalizedFallback)
    && !/^untitled document$/i.test(normalizedFallback)
    && !/^summary\s*:/i.test(normalizedFallback)
  ) {
    return normalizedFallback.slice(0, 120);
  }

  const lines = (text || '')
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim().replace(/^[-_:;,.]+|[-_:;,.]+$/g, ''))
    .filter(line => line.length >= 6 && /[A-Za-z]/.test(line))
    .filter(line => !/^summary\s*:/i.test(line));

  const subjectLine = lines.find(line => /^subject\s*:/i.test(line));
  if (subjectLine) {
    const subject = subjectLine.replace(/^subject\s*:\s*/i, '').trim();
    if (subject) return subject.slice(0, 120);
  }

  return (lines[0] || normalizedFallback || 'Scanned Document').slice(0, 120);
};

const normalizeDateForInput = (value) => {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toISOString().split('T')[0];
};

const isPlaceholderSubject = (value) => {
  const subject = (value || '').trim();
  return !subject || /^scanned document$/i.test(subject) || /^untitled document$/i.test(subject);
};

const resolveAutoSubject = (doc) => {
  if (!doc) return '';
  if (!isPlaceholderSubject(doc.subject)) {
    return String(doc.subject).trim().slice(0, 120);
  }
  const fromText = getSubjectFromOcr(doc.scannedText || '', '');
  return isPlaceholderSubject(fromText) ? '' : fromText;
};

const Scanner = ({ onCapture, onEditDocument, currentUser, offices = defaultOffices, documentTypes = defaultDocumentTypes, device: deviceProp }) => {
  const { device, cameOnline } = useLiveDevice(deviceProp);
  const camera = useRef(null);
  const commandPollRef = useRef(null);
  const commandPollBusyRef = useRef(false);
  const appliedScanCommandsRef = useRef(new Set());
  const enrichPollRef = useRef(null);
  const autoFilledRef = useRef({});
  const previewImgRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const wsPaintGenRef = useRef(0);
  const pendingPaintRef = useRef(false);
  const previewReadyRef = useRef(false);
  const lanSnapshotStarterRef = useRef(null);
  const paintedFramesRef = useRef(0);
  const lastFrameAtRef = useRef(0);
  const lastFrameRef = useRef(null);
  const staleReloadAtRef = useRef(0);
  const streamStaleRef = useRef(false);
  const realtime = useOptionalRealtime();
  const canChooseSourceOffice = false;
  const canChooseDirection = false;
  const canSetInitialStatus = false;
  const defaultSourceOfficeId = currentUser?.officeId || offices[0]?.id || MAYORS_OFFICE_ID;
  const receptionOfficeId = currentUser?.officeId || MAYORS_OFFICE_ID;
  const mayorsOfficeId = offices.find(o => o.name?.toLowerCase().includes('mayor'))?.id || MAYORS_OFFICE_ID;
  const getNextOfficeId = (fromOfficeId) => offices.find(o => o.id !== fromOfficeId)?.id || fromOfficeId;
  const isOtherDocumentType = (typeId) => {
    const docType = documentTypes.find(item => item.id === typeId);
    return docType?.category?.toLowerCase().includes('other');
  };
  // Step 1 = Scan, Step 2 = Fill Details, Step 3 = Review, Step 4 = Done
  const [step, setStep] = useState(1);
  const [cameraSource] = useState(PHYSICAL_CAMERA_VALUE);
  const [paperGuideId, setPaperGuideId] = useState('letter-landscape');
  const [pagesToCaptureInput, setPagesToCaptureInput] = useState('1');
  const MAX_SCAN_ATTACHMENTS = 50; // keep in sync with backend MAX_ATTACHMENTS_PER_DOCUMENT
  const requiredCaptureCount = (() => {
    const parsed = Number(pagesToCaptureInput);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return Math.min(MAX_SCAN_ATTACHMENTS, Math.floor(parsed));
  })();
  const commitPagesToCapture = () => {
    const parsed = Number(pagesToCaptureInput);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setPagesToCaptureInput('1');
      return;
    }
    setPagesToCaptureInput(String(Math.min(MAX_SCAN_ATTACHMENTS, Math.floor(parsed))));
  };
  const sanitizeCapturedFiles = (files = []) => {
    const seen = new Set();
    const out = [];
    for (const file of files) {
      if (!file) continue;
      const key = file.id || file.url || file.previewUrl || file.dataUrl || file.name;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: file.id,
        name: file.name || 'scan.jpg',
        type: file.type || 'image/jpeg',
        size: file.size,
        url: file.url || file.previewUrl || undefined,
        dataUrl: file.dataUrl,
        source: file.source || 'scanner',
        uploadedAt: file.uploadedAt,
      });
      if (out.length >= MAX_SCAN_ATTACHMENTS) break;
    }
    return out;
  };
  const [showPaperGuide, setShowPaperGuide] = useState(false);
  const [streamReloadKey, setStreamReloadKey] = useState(0);
  const [previewMode, setPreviewMode] = useState('ws');
  const [lanBridgeBase, setLanBridgeBase] = useState(null);
  const [directStreamUrl, setDirectStreamUrl] = useState('');
  const [previewErrorMessage, setPreviewErrorMessage] = useState('');
  const [streamHasError, setStreamHasError] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [streamStale, setStreamStale] = useState(false);
  const [streamStats, setStreamStats] = useState({ paint: 0 });
  const [streamDims, setStreamDims] = useState({ width: 0, height: 0 });
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSubjectExtracting, setIsSubjectExtracting] = useState(false);
  const [enrichmentHint, setEnrichmentHint] = useState('');
  const [progress, setProgress] = useState(0);
  const [isDeviceScanning, setIsDeviceScanning] = useState(false);
  const [deviceScanStatus, setDeviceScanStatus] = useState('');
  const [isMotorTesting, setIsMotorTesting] = useState(false);
  const [lightOn, setLightOn] = useState(false);
  const [isLightBusy, setIsLightBusy] = useState(false);
  const [lightStatus, setLightStatus] = useState('');
  const lightCommandAtRef = useRef(0);
  const lightSceneIndexRef = useRef(null);
  const [lightBrightness, setLightBrightness] = useState(50);
  const [liveLight, setLiveLight] = useState(null);
  const lightResultsRef = useRef(new Map());
  const lightDraggingRef = useRef(false);
  const cameraLightState = { ...(device?.payload?.cameraLight || {}), ...(liveLight || {}) };
  const motorTestAbortRef = useRef(false);
  const [sortStatus, setSortStatus] = useState(null);
  const sortPollAbortRef = useRef(false);

  // Scan results
  const [capturedImage, setCapturedImage] = useState(null);
  const [capturedFileType, setCapturedFileType] = useState('');
  const [capturedImages, setCapturedImages] = useState([]);
  const capturedImagesRef = useRef([]);
  const [extractedText, setExtractedText] = useState('');
  const [hardwareScannedDoc, setHardwareScannedDoc] = useState(null);

  // Document form state (filled AFTER scanning)
  const [formData, setFormData] = useState({
    subject: '',
    documentDirection: 'Incoming',
    documentTypeId: documentTypes[0]?.id || 'DT-001',
    documentTypeOther: '',
    status: 'Received',
    priorityLevel: 'normal',
    fromOfficeId: defaultSourceOfficeId,
    originOfficeOther: '',
    toOfficeId: getNextOfficeId(receptionOfficeId),
    dateReceived: new Date().toISOString().split('T')[0],
    senderName: '',
    senderContact: '',
    senderEmail: '',
    notifySender: true,
    senderNotificationConsent: true,
    senderNotificationChannels: ['sms'],
    remarks: '',
  });
  const [formErrors, setFormErrors] = useState({});
  const [formErrorSummary, setFormErrorSummary] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    return () => {
      if (commandPollRef.current) clearInterval(commandPollRef.current);
      if (enrichPollRef.current) clearInterval(enrichPollRef.current);
    };
  }, []);

  const handleFormChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setFormErrors(prev => clearFieldError(prev, field));
    if (formErrorSummary) setFormErrorSummary('');
  };

  const validateScannerDetails = () => validateRequiredFields([
    { key: 'subject', label: 'Document subject', value: formData.subject },
    { key: 'senderName', label: 'Sender name', value: formData.senderName },
    { key: 'toOfficeId', label: 'Destination office', value: formData.toOfficeId },
    {
      key: 'documentTypeOther',
      label: 'Document type',
      value: formData.documentTypeOther,
      when: isOtherDocumentType(formData.documentTypeId),
    },
  ]);

  const applyExtractedDocFields = (doc, auto = {}) => {
    const newSubject = resolveAutoSubject(doc);
    const newSender = doc.senderName && doc.senderName !== 'Scanner Device' ? doc.senderName : '';
    const newText = doc.scannedText || '';
    const newDate = normalizeDateForInput(doc.dateReceived);
    const newDocTypeId = doc.documentTypeId || '';

    const enriched = (
      (newText && newText !== auto.scannedText)
      || (!isPlaceholderSubject(newSubject) && newSubject !== auto.subject)
      || (newSender && newSender !== auto.senderName)
      || (newDate && newDate !== auto.dateReceived)
      || (newDocTypeId && newDocTypeId !== auto.documentTypeId)
    );
    if (!enriched) return false;

    setExtractedText((prev) => (prev === auto.scannedText || !prev ? newText : prev));
    setFormData((prev) => ({
      ...prev,
      subject: (isPlaceholderSubject(prev.subject) || prev.subject === auto.subject) && !isPlaceholderSubject(newSubject)
        ? newSubject
        : prev.subject,
      senderName: (!prev.senderName || prev.senderName === auto.senderName) && newSender
        ? newSender
        : prev.senderName,
      documentTypeId: (!prev.documentTypeId || prev.documentTypeId === auto.documentTypeId) && newDocTypeId
        ? newDocTypeId
        : prev.documentTypeId,
      dateReceived: (!prev.dateReceived || prev.dateReceived === auto.dateReceived) && newDate
        ? newDate
        : prev.dateReceived,
    }));
    autoFilledRef.current = {
      subject: newSubject,
      senderName: newSender,
      scannedText: newText,
      documentTypeId: newDocTypeId,
      dateReceived: newDate,
    };
    return true;
  };

  const toggleSenderChannel = (channel) => {
    setFormData(prev => {
      const channels = prev.senderNotificationChannels || [];
      return {
        ...prev,
        senderNotificationChannels: channels.includes(channel)
          ? channels.filter(item => item !== channel)
          : [...channels, channel],
      };
    });
  };

  const isPhysicalSource = true;
  const selectedPaperGuide = paperGuides.find(item => item.id === paperGuideId) || paperGuides[0];
  const paperGuideLayout = getPaperGuideLayout(selectedPaperGuide);
  const previewFitMode = getPreviewFitMode();
  const previewPaintOptions = useMemo(
    () => ({ fitMode: previewFitMode }),
    [previewFitMode],
  );
  const previewAspectWidth = streamDims.width || selectedPaperGuide.width;
  const previewAspectHeight = streamDims.height || selectedPaperGuide.height;
  const previewAspectRatio = previewAspectWidth / previewAspectHeight;
  const previewShellClassName = [
    'scanner-preview-shell',
    paperGuideLayout.shellClass,
    previewReady ? 'scanner-preview-shell--live' : '',
  ].filter(Boolean).join(' ');
  const previewShellStyle = {
    aspectRatio: `${previewAspectWidth} / ${previewAspectHeight}`,
    maxWidth: previewAspectRatio < 1 ? 'min(100%, 420px)' : '100%',
    minHeight: 0,
  };
  const deviceStreamResolution = parseResolutionLabel(
    device?.payload?.streamResolution || device?.payload?.previewResolution,
  );
  const streamResolutionLabel = (() => {
    if (streamDims.width > 0 && streamDims.height > 0) {
      return `${streamDims.width}×${streamDims.height}`;
    }
    if (deviceStreamResolution) {
      return `${deviceStreamResolution.width}×${deviceStreamResolution.height}`;
    }
    return null;
  })();
  const streamIs2k = streamDims.width > 0
    ? is2kResolution(streamDims)
    : (device?.payload?.streamIs2K === true || is2kResolution(deviceStreamResolution || {}));
  const adaptiveStreamFps = Number(device?.payload?.adaptiveStreamFps || device?.payload?.previewFps || 0);
  const isCapturedPdf = isPdfMedia(capturedImage, capturedFileType);
  const renderCapturedImageGallery = (alt) => (
    <div className="scanner-captured-gallery">
      {capturedImages.map((file, index) => (
        <div className="scanner-captured-gallery-item" key={file.id || `${file.url}-${index}`}>
          {renderScannedDocumentPreview(file.previewUrl || file.url, {
            alt: `${alt} ${index + 1}`,
            isPdf: isPdfMedia(file.previewUrl || file.url, file.type),
          })}
          <span>Capture {index + 1}</span>
        </div>
      ))}
    </div>
  );
  const deviceId = device?.id || 'DEV-001';
  const streamChannel = `scanner:${deviceId}:stream`;
  const streamOnline = device?.connected || device?.streamWsConnected === true;
  const usesWsJpegStream = deviceUsesWsJpegStream(device);
  const hasLanBridge = Boolean(
    isPhysicalSource && streamOnline && lanBridgeBase && !usesWsJpegStream,
  );
  const previewLabel = previewMode === 'direct'
    ? 'Live via Pi LAN (MJPEG)'
    : previewMode === 'lan-snapshot'
      ? 'Live via Pi LAN (snapshot)'
      : previewMode === 'ws'
        ? 'Live via WebSocket'
        : 'Live via snapshot';

  const paintPreviewBlob = useCallback((blob) => {
    if (!blob?.size || !previewCanvasRef.current) return;
    blob.arrayBuffer().then((buffer) => {
      paintWsFrameToCanvas(
        previewCanvasRef.current,
        new Uint8Array(buffer),
        wsPaintGenRef,
        () => {
          lastFrameAtRef.current = Date.now();
          if (!previewReadyRef.current) {
            previewReadyRef.current = true;
            setPreviewReady(true);
          }
          if (streamStaleRef.current) {
            streamStaleRef.current = false;
            setStreamStale(false);
          }
          setStreamHasError(false);
          setPreviewErrorMessage('');
        },
        previewPaintOptions,
      );
    }).catch(() => {});
  }, [previewPaintOptions]);

  const scheduleFramePaint = useCallback((frame) => {
    if (!frame?.length) return;
    lastFrameRef.current = frame;
    lastFrameAtRef.current = Date.now();
    const jpegDims = readJpegDimensions(frame);
    if (jpegDims) {
      setStreamDims((prev) => (
        prev.width === jpegDims.width && prev.height === jpegDims.height
          ? prev
          : jpegDims
      ));
    }
    if (pendingPaintRef.current) return;
    pendingPaintRef.current = true;
    const paintLatest = () => {
      pendingPaintRef.current = false;
      const latest = lastFrameRef.current;
      if (!latest?.length || !previewCanvasRef.current) return;
      paintedFramesRef.current += 1;
      paintWsFrameToCanvas(
        previewCanvasRef.current,
        latest,
        wsPaintGenRef,
        () => {
          if (streamStaleRef.current) {
            streamStaleRef.current = false;
            setStreamStale(false);
          }
          if (!previewReadyRef.current) {
            previewReadyRef.current = true;
            setPreviewReady(true);
            setPreviewMode('ws');
            setStreamHasError(false);
            setPreviewErrorMessage('');
          }
        },
        previewPaintOptions,
      );
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(paintLatest);
    } else if (typeof queueMicrotask === 'function') {
      queueMicrotask(paintLatest);
    } else {
      paintLatest();
    }
  }, [previewPaintOptions]);

  // Repaint last frame when paper guide changes the preview shell layout.
  useEffect(() => {
    const frame = lastFrameRef.current;
    if (!frame?.length || !previewCanvasRef.current) return;
    requestAnimationFrame(() => {
      paintWsFrameToCanvas(
        previewCanvasRef.current,
        frame,
        wsPaintGenRef,
        undefined,
        previewPaintOptions,
      );
    });
  }, [paperGuideId, paperGuideLayout.shellClass, previewPaintOptions]);

  useEffect(() => {
    if (!isPhysicalSource) {
      setStreamHasError(false);
      setPreviewErrorMessage('');
      return undefined;
    }

    if (!device?.connected && device?.streamWsConnected !== true) {
      setStreamHasError(true);
      setPreviewErrorMessage('Physical scanner is offline. Wait for device heartbeat.');
      return undefined;
    }

    if (!realtime?.connected) {
      setStreamHasError(false);
      setPreviewErrorMessage('Connecting to realtime server...');
      return undefined;
    }

    if (previewReady) {
      setStreamHasError(false);
      setPreviewErrorMessage('');
      return undefined;
    }

    setStreamHasError(false);
    setPreviewErrorMessage('Connecting to camera stream...');
    return undefined;
  }, [isPhysicalSource, device?.connected, device?.streamWsConnected, realtime?.connected, previewReady, streamReloadKey]);

  useEffect(() => {
    if (!previewReady || isDeviceScanning) return;
    setDeviceScanStatus((prev) => (
      /no camera frame|no preview frame|failed|timeout|cancelled/i.test(prev || '')
        ? ''
        : prev
    ));
  }, [previewReady, isDeviceScanning]);

  useEffect(() => {
    if (!isPhysicalSource || !streamOnline || usesWsJpegStream) {
      setLanBridgeBase(null);
      return undefined;
    }
    let cancelled = false;
    const base = getReportedBridgeUrl(device);
    if (!base) return undefined;
    (async () => {
      const probed = await probeLanBridge(base, deviceId);
      if (!cancelled && probed) {
        setLanBridgeBase(probed);
      }
    })();
    return () => { cancelled = true; };
  }, [isPhysicalSource, streamOnline, usesWsJpegStream, device, deviceId]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const shell = canvas?.parentElement;
    if (!canvas || !shell) return undefined;

    const syncCanvasSize = () => {
      const rect = shell.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    syncCanvasSize();
    const ro = new ResizeObserver(() => {
      syncCanvasSize();
      const frame = lastFrameRef.current;
      if (frame?.length && previewCanvasRef.current) {
        paintWsFrameToCanvas(
          previewCanvasRef.current,
          frame,
          wsPaintGenRef,
          undefined,
          previewPaintOptions,
        );
      }
    });
    ro.observe(shell);
    return () => ro.disconnect();
  }, [streamReloadKey, paperGuideId, previewPaintOptions]);

  // Hard reset: switching device clears preview.
  useEffect(() => {
    previewReadyRef.current = false;
    setPreviewReady(false);
    streamStaleRef.current = false;
    setStreamStale(false);
    setPreviewMode('ws');
    setDirectStreamUrl('');
    lastFrameAtRef.current = 0;
    wsPaintGenRef.current += 1;
    const canvas = previewCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx?.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (previewImgRef.current) {
      previewImgRef.current.removeAttribute('src');
    }
  }, [device?.id, cameraSource]);

  // Pi came online — resubscribe only if preview not running yet.
  useEffect(() => {
    if (!cameOnline) return;
    setStreamHasError(false);
    setPreviewErrorMessage('');
    staleReloadAtRef.current = 0;
    if (!previewReadyRef.current) {
      setStreamReloadKey((value) => value + 1);
    }
  }, [cameOnline]);

  // Soft reload (stale watchdog): keep the last painted frame visible so the
  // preview looks frozen under the "Reconnecting" overlay instead of flashing
  // black. Resubscription happens in the stream effects keyed on streamReloadKey.
  useEffect(() => {
    setDirectStreamUrl('');
  }, [streamReloadKey]);

  useEffect(() => {
    if (!hasLanBridge) {
      setDirectStreamUrl('');
      return undefined;
    }
    // WebSocket preview wins — don't poll LAN snapshots on the same surface.
    if (previewReadyRef.current && previewMode === 'ws') {
      return undefined;
    }

    let cancelled = false;
    let snapshotTimer = null;
    const lanBase = lanBridgeBase;

    const startLanSnapshotPolling = () => {
      if (cancelled || snapshotTimer || (previewReadyRef.current && previewMode === 'ws')) return;
      setDirectStreamUrl('');
      setPreviewMode('lan-snapshot');

      const pollLanSnapshot = async () => {
        if (previewReadyRef.current && previewMode === 'ws') return;
        try {
          const blob = await bridgeService.snapshot({ deviceId, bridgeUrl: lanBase });
          if (cancelled || !blob?.size) return;
          paintPreviewBlob(blob);
          setPreviewMode('lan-snapshot');
        } catch (err) {
          if (!cancelled && !previewReadyRef.current) {
            setStreamHasError(true);
            setPreviewErrorMessage(`LAN camera preview failed: ${err.message || 'snapshot unavailable'}`);
          }
        }
      };

      pollLanSnapshot();
      snapshotTimer = setInterval(pollLanSnapshot, SNAPSHOT_POLL_MS);
    };

    lanSnapshotStarterRef.current = startLanSnapshotPolling;

    const probeLanStream = async () => {
      try {
        const result = await bridgeService.probe({ bridgeUrl: lanBase, deviceId });
        if (cancelled) return;
        if (result?.ok && result?.mjpegEnabled) {
          setPreviewMode('direct');
          setDirectStreamUrl(`${lanBase}/stream.mjpg`);
          lanSnapshotStarterRef.current = startLanSnapshotPolling;
          return;
        }
      } catch {
        // MJPEG unavailable — snapshot polling instead.
      }
      if (!cancelled) startLanSnapshotPolling();
    };

    probeLanStream();

    return () => {
      cancelled = true;
      if (snapshotTimer) clearInterval(snapshotTimer);
    };
  }, [hasLanBridge, lanBridgeBase, deviceId, paintPreviewBlob, previewMode]);

  useEffect(() => {
    if (!isPhysicalSource || !previewReady || previewMode === 'direct') {
      setStreamStale(false);
      return undefined;
    }

    const interval = setInterval(() => {
      const last = lastFrameAtRef.current;
      if (!last) return;
      const age = Date.now() - last;
      // Quiet grace: keep last frame while heartbeat says Online.
      // Only show the reconnect overlay after a long stall.
      if (age < STREAM_STALE_OVERLAY_MS) {
        if (streamStaleRef.current) {
          streamStaleRef.current = false;
          setStreamStale(false);
        }
        return;
      }

      if (!streamStaleRef.current) {
        streamStaleRef.current = true;
        setStreamStale(true);
      }
      // Keep last frame — do not auto tear down WS subscription.
    }, 1000);

    return () => clearInterval(interval);
  }, [isPhysicalSource, previewReady, previewMode, directStreamUrl]);

  useEffect(() => {
    if (!isPhysicalSource) return undefined;
    const interval = setInterval(() => {
      setStreamStats({ paint: paintedFramesRef.current });
      paintedFramesRef.current = 0;
    }, 1000);
    return () => clearInterval(interval);
  }, [isPhysicalSource]);

  useEffect(() => {
    if (!isPhysicalSource || !previewReady || !deviceId || !realtime?.client?.connected) {
      return undefined;
    }
    const reportConsumerFps = () => {
      realtime.client.sendMessage({
        type: 'stream:consumer',
        deviceId,
        paintFps: streamStats.paint || 0,
      });
    };
    reportConsumerFps();
    const interval = setInterval(reportConsumerFps, 2000);
    return () => clearInterval(interval);
  }, [isPhysicalSource, previewReady, deviceId, realtime?.client, realtime?.connected, streamStats.paint]);

  useEffect(() => {
    if (!isPhysicalSource || !streamOnline || !realtime?.client || !realtime?.connected) {
      return undefined;
    }

    let streamTimeout = null;
    let snapshotTimer = null;
    let cancelled = false;
    let snapshotInFlight = false;

    const bindStream = () => {
      realtime.subscribeChannel(streamChannel);
    };

    const pullCachedSnapshot = async () => {
      if (cancelled || snapshotInFlight || previewReadyRef.current) return false;
      snapshotInFlight = true;
      try {
        const blob = await bridgeService.snapshot({ deviceId });
        if (cancelled || !blob?.size) return false;
        paintPreviewBlob(blob);
        setPreviewMode(usesWsJpegStream ? 'ws-cached' : 'snapshot');
        if (streamTimeout) {
          clearTimeout(streamTimeout);
          streamTimeout = null;
        }
        setStreamHasError(false);
        setPreviewErrorMessage('');
        return true;
      } catch (err) {
        if (!cancelled && err?.status === 503 && err?.message) {
          setStreamHasError(true);
          setPreviewErrorMessage(err.message);
        }
        return false;
      } finally {
        snapshotInFlight = false;
      }
    };

    bindStream();
    const offOpen = realtime.subscribe('connection:open', () => {
      bindStream();
      streamStaleRef.current = false;
      setStreamStale(false);
      setPreviewErrorMessage('');
    });
    const offFrame = realtime.subscribe('scanner:frame', ({ frame }) => {
      scheduleFramePaint(frame);
      if (streamTimeout) {
        clearTimeout(streamTimeout);
        streamTimeout = null;
      }
      setStreamHasError(false);
      setPreviewErrorMessage('');
    });

    const startSnapshotFallback = () => {
      if (snapshotTimer || previewReadyRef.current) return;
      pullCachedSnapshot();
      snapshotTimer = setInterval(() => {
        if (previewReadyRef.current) {
          clearInterval(snapshotTimer);
          snapshotTimer = null;
          return;
        }
        pullCachedSnapshot();
      }, SNAPSHOT_POLL_MS);
    };

    streamTimeout = setTimeout(() => {
      if (!previewReadyRef.current) {
        setStreamHasError(true);
        setPreviewErrorMessage(
          device?.streamWsConnected === false
            ? 'Pi WebSocket stream is offline. Trying snapshot preview...'
            : 'Waiting for camera frames from Pi...',
        );
        startSnapshotFallback();
      }
    }, WS_STREAM_TIMEOUT_MS);

    return () => {
      cancelled = true;
      offOpen?.();
      offFrame?.();
      if (streamTimeout) clearTimeout(streamTimeout);
      if (snapshotTimer) clearInterval(snapshotTimer);
      realtime.client?.unsubscribe(streamChannel);
    };
  }, [
    isPhysicalSource,
    streamOnline,
    realtime,
    realtime?.connected,
    streamChannel,
    streamReloadKey,
    deviceId,
    device?.streamWsConnected,
    usesWsJpegStream,
    scheduleFramePaint,
    paintPreviewBlob,
  ]);

  useEffect(() => {
    if (!realtime?.client) return undefined;
    const offClose = realtime.subscribe('connection:close', () => {
      if (!previewReadyRef.current) {
        setStreamStale(true);
        setPreviewErrorMessage('Reconnecting to realtime server...');
      }
    });
    return () => offClose();
  }, [realtime, realtime?.connected]);

  const startEnrichmentPolling = (commandId, expectsAi = false) => {
    if (!expectsAi) {
      setIsSubjectExtracting(false);
      setEnrichmentHint('');
      return;
    }
    if (enrichPollRef.current) {
      clearInterval(enrichPollRef.current);
      enrichPollRef.current = null;
    }
    setIsSubjectExtracting(true);
    setEnrichmentHint('');
    let attempts = 0;
    enrichPollRef.current = setInterval(async () => {
      attempts += 1;
      if (attempts > 30) {
        clearInterval(enrichPollRef.current);
        enrichPollRef.current = null;
        setIsSubjectExtracting(false);
        setEnrichmentHint(
          isPlaceholderSubject(autoFilledRef.current?.subject)
            ? 'Auto-fill did not finish. Enter the subject and other fields manually.'
            : '',
        );
        return;
      }
      setEnrichmentHint('Reading document fields from scan...');
      try {
        const result = await commandService.checkStatus(commandId);
        const doc = result?.resultDocument;
        if (!doc) return;

        const auto = autoFilledRef.current || {};
        if (applyExtractedDocFields(doc, auto)) {
          clearInterval(enrichPollRef.current);
          enrichPollRef.current = null;
          setIsSubjectExtracting(false);
          setEnrichmentHint('');
        }
      } catch {
        // Keep polling; the enrichment may not be ready yet.
      }
    }, 2500);
  };

  const applyPhysicalScanResult = (result, commandId) => {
    if (result.status === 'Executed') {
      // One command → one gallery image (ignore duplicate poll responses).
      if (commandId && appliedScanCommandsRef.current.has(commandId)) {
        return true;
      }
      if (commandId) {
        appliedScanCommandsRef.current.add(commandId);
      }

      const doc = result.resultDocument;
      setHardwareScannedDoc(doc || null);
      if (doc) {
        const existingCaptureKeys = new Set(
          capturedImagesRef.current.flatMap((file) => [
            file.id,
            file.url,
            file.previewUrl,
            file.dataUrl,
          ]).filter(Boolean),
        );
        const scanPageCandidates = (doc.scannedFiles || []).flatMap((file) => (
          Array.isArray(file?.pages) ? file.pages : [file]
        ));
        const scannedFile = scanPageCandidates.find((file) => (
          !isPdfMedia(file?.url, file?.type)
          && !existingCaptureKeys.has(file?.id || file?.url || file?.dataUrl)
        ));
        if (!scannedFile) {
          setIsDeviceScanning(false);
          setDeviceScanStatus('The scanner response did not include a new page. Please retry this capture.');
          return true;
        }
        const scannedUrl = resolveUploadUrl(
          (scannedFile?.url && !isPdfMedia(scannedFile.url, scannedFile.type) ? scannedFile.url : null)
          || (doc.scannedImageUrl && !isPdfMedia(doc.scannedImageUrl) ? doc.scannedImageUrl : null)
          || scannedFile?.url
          || doc.scannedImageUrl
          || scannedFile?.dataUrl
          || null,
        );
        const scannedType = scannedFile?.type || (isPdfMedia(scannedUrl) ? 'application/pdf' : 'image/jpeg');
        const captureNumber = capturedImagesRef.current.length + 1;
        if (captureNumber > requiredCaptureCount || captureNumber > MAX_SCAN_ATTACHMENTS) {
          setIsDeviceScanning(false);
          return true;
        }
        const captureFile = {
          id: scannedFile?.id || `${commandId || 'capture'}-${captureNumber}`,
          name: scannedFile?.name || `scan-${captureNumber}.jpg`,
          type: scannedType,
          size: scannedFile?.size,
          url: scannedFile?.url || scannedUrl,
          previewUrl: scannedUrl,
          source: scannedFile?.source || 'camera',
          uploadedAt: scannedFile?.uploadedAt,
        };
        capturedImagesRef.current = sanitizeCapturedFiles([
          ...capturedImagesRef.current,
          captureFile,
        ]);
        setCapturedImages(capturedImagesRef.current);
        const autoSubject = resolveAutoSubject(doc);
        const autoSender = doc.senderName && doc.senderName !== 'Scanner Device' ? doc.senderName : '';
        const autoDate = normalizeDateForInput(doc.dateReceived);
        autoFilledRef.current = {
          subject: autoSubject,
          senderName: autoSender,
          scannedText: doc.scannedText || '',
          documentTypeId: doc.documentTypeId || '',
          dateReceived: autoDate,
        };
        if (captureNumber === 1) setCapturedImage(scannedUrl);
        setCapturedFileType(scannedType);
        if (captureNumber === 1) {
          setExtractedText(doc.scannedText || '');
          setFormData(prev => ({
            ...prev,
            subject: autoSubject,
            documentDirection: doc.documentDirection || prev.documentDirection,
            documentTypeId: doc.documentTypeId || prev.documentTypeId,
            documentTypeOther: doc.documentTypeOther || prev.documentTypeOther,
            status: doc.status || prev.status,
            priorityLevel: doc.priorityLevel || prev.priorityLevel,
            fromOfficeId: doc.currentOfficeId || doc.originOfficeId || prev.fromOfficeId,
            originOfficeOther: doc.originOfficeOther || prev.originOfficeOther,
            toOfficeId: doc.destinationOfficeId || prev.toOfficeId,
            dateReceived: autoDate || doc.dateReceived || prev.dateReceived,
            senderName: autoSender,
            senderContact: doc.senderContact || prev.senderContact,
            senderEmail: doc.senderEmail || prev.senderEmail,
            notifySender: doc.notifySender ?? prev.notifySender,
            senderNotificationConsent: doc.senderNotificationConsent ?? prev.senderNotificationConsent,
            senderNotificationChannels: doc.senderNotificationChannels?.length ? doc.senderNotificationChannels : prev.senderNotificationChannels,
            remarks: doc.remarks || prev.remarks,
          }));
        }
        // AI extraction may still be running on the Pi. Poll only when the Pi flagged it.
        if (captureNumber === 1 && commandId) startEnrichmentPolling(commandId, Boolean(result?.payload?.aiExtractPending));
      }
      setIsDeviceScanning(false);
      if (capturedImagesRef.current.length >= requiredCaptureCount) {
        setDeviceScanStatus(`${requiredCaptureCount} capture${requiredCaptureCount === 1 ? '' : 's'} complete. Review the captured images below.`);
        setStep(2);
      } else {
        setDeviceScanStatus(
          `Capture ${capturedImagesRef.current.length} of ${requiredCaptureCount} saved. `
          + `Move the next page/part under the camera, then press Capture again.`,
        );
      }
      return true;
    }

    if (result.status === 'Failed' || result.status === 'Cancelled') {
      setIsDeviceScanning(false);
      setDeviceScanStatus(toUserFacingError(
        result.errorMessage,
        `Physical scanner command ${result.status.toLowerCase()}.`,
      ));
      return true;
    }

    return false;
  };

  // STEP 1: Capture/scan the document
  const handleCapture = async () => {
    await handlePhysicalScan();
  };

  const handlePhysicalScan = async () => {
    if (!device?.connected) {
      setDeviceScanStatus('Physical scanner is offline. Wait for the device heartbeat before sending a scan command.');
      return;
    }
    if (isDeviceScanning) {
      return;
    }
    if (capturedImagesRef.current.length >= requiredCaptureCount) {
      setDeviceScanStatus(`Already captured ${requiredCaptureCount} page${requiredCaptureCount === 1 ? '' : 's'}. Continue to details or rescan.`);
      return;
    }

    setIsDeviceScanning(true);
    setDeviceScanStatus('Sending scan command to physical scanner...');
    // Only reset AI/form helpers on the first page of a multi-page session.
    if (capturedImagesRef.current.length === 0) {
      setIsSubjectExtracting(false);
      setEnrichmentHint('');
      setHardwareScannedDoc(null);
      setExtractedText('');
      autoFilledRef.current = {
        subject: '',
        senderName: '',
        scannedText: '',
        documentTypeId: '',
        dateReceived: '',
      };
      setFormData((prev) => ({
        ...prev,
        subject: '',
        senderName: '',
      }));
    }

    try {
      const command = await commandService.sendScan(device.id || 'DEV-001', {
        officeId: formData.fromOfficeId === OTHER_OFFICE_VALUE ? defaultSourceOfficeId : formData.fromOfficeId,
        originOfficeOther: formData.originOfficeOther,
        status: canSetInitialStatus ? formData.status : 'Received',
        priorityLevel: formData.priorityLevel,
        documentTypeId: formData.documentTypeId,
        sortLayer: resolveSortLayer(formData.documentTypeId),
        scanOrientation: selectedPaperGuide.orientation || 'landscape',
        paperGuideId: selectedPaperGuide.id,
        scanWidth: streamDims.width > 0 ? streamDims.width : (deviceStreamResolution?.width || 1920),
        scanHeight: streamDims.height > 0 ? streamDims.height : (deviceStreamResolution?.height || 1080),
        documentId: hardwareScannedDoc?.id || undefined,
        // Always 1 frame per press — multi-page = multiple button presses.
        captureFrameCount: 1,
      });
      setDeviceScanStatus(
        requiredCaptureCount > 1
          ? `Capturing page ${capturedImagesRef.current.length + 1} of ${requiredCaptureCount}...`
          : 'Waiting for the physical scanner to capture and upload the document...',
      );

      if (commandPollRef.current) {
        clearInterval(commandPollRef.current);
        commandPollRef.current = null;
      }
      commandPollBusyRef.current = false;
      let attempts = 0;
      commandPollRef.current = setInterval(async () => {
        if (commandPollBusyRef.current) return;
        commandPollBusyRef.current = true;
        attempts += 1;
        try {
          const result = await commandService.checkStatus(command.id);
          if (applyPhysicalScanResult(result, command.id)) {
            clearInterval(commandPollRef.current);
            commandPollRef.current = null;
          } else if (attempts > 90) {
            clearInterval(commandPollRef.current);
            commandPollRef.current = null;
            setIsDeviceScanning(false);
            setDeviceScanStatus('Timeout waiting for the physical scanner. Please try again.');
          }
        } catch {
          // Keep polling while the backend or device is busy.
        } finally {
          commandPollBusyRef.current = false;
        }
      }, 500);
    } catch (err) {
      setIsDeviceScanning(false);
      const isPendingConflict = /pending .*command/i.test(err.message || '');
      setDeviceScanStatus(
        isPendingConflict
          ? 'The scanner is still busy with a previous scan. Cancel it or wait a moment, then try again.'
          : toUserFacingError(err.message, 'Unable to send scan command.'),
      );
    }
  };

  const handleCancelPhysicalScan = async () => {
    if (commandPollRef.current) {
      clearInterval(commandPollRef.current);
      commandPollRef.current = null;
    }

    setDeviceScanStatus('Cancelling pending scan command...');

    try {
      const result = await commandService.cancelPending(device?.id || 'DEV-001');
      setIsDeviceScanning(false);
      setDeviceScanStatus(
        result.cancelled
          ? `Cancelled ${result.cancelled} pending scan command(s). You can capture again.`
          : 'No pending scan command found. You can try capture again.',
      );
    } catch (err) {
      setIsDeviceScanning(false);
      setDeviceScanStatus(toUserFacingError(err.message, 'Unable to cancel scan command.'));
    }
  };

  useEffect(() => () => {
    motorTestAbortRef.current = true;
    sortPollAbortRef.current = true;
  }, []);

  const watchSortCommand = async (commandId, sortLayer) => {
    sortPollAbortRef.current = false;
    let lastStatus = 'Pending';
    const deadline = Date.now() + 600000;
    while (!sortPollAbortRef.current && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      let result;
      try {
        result = await commandService.checkStatus(commandId);
      } catch {
        continue;
      }
      if (sortPollAbortRef.current || !result?.status) continue;
      if (result.status === 'Executing' && lastStatus !== 'Executing') {
        setSortStatus({ state: 'running', message: `Sorter is moving the document to tray layer ${sortLayer}...` });
      }
      lastStatus = result.status;
      if (result.status === 'Executed') {
        setSortStatus({ state: 'done', message: `Document sorted into tray layer ${sortLayer}.` });
        return;
      }
      if (result.status === 'Failed' || result.status === 'Cancelled') {
        setSortStatus({ state: 'failed', message: `Sorter failed: ${result.errorMessage || result.status}` });
        return;
      }
    }
    if (!sortPollAbortRef.current) {
      setSortStatus({
        state: 'failed',
        message: lastStatus === 'Executing'
          ? 'Sorter did not report back in 10 minutes — the lift may still be searching for the tray hall sensor.'
          : 'The Pi never picked up the sort command. Check the scanner connection.',
      });
    }
  };

  const handleMotorTest = async () => {
    if (isMotorTesting || isDeviceScanning) return;
    if (!device?.connected) {
      setDeviceScanStatus('Scanner is offline. Check Pi power and network, then wait for heartbeat.');
      return;
    }
    motorTestAbortRef.current = false;
    setIsMotorTesting(true);
    setDeviceScanStatus('Motor test: lift DOWN → UP, then sort one turn...');
    try {
      const command = await commandService.sendMotorTest(device.id || 'DEV-001');
      if (command?.delivered === false) {
        setDeviceScanStatus('Motor test queued — Pi live link is down, sending through the backup heartbeat link (up to ~10s)...');
      }
      let lastStatus = command?.status || 'Pending';
      const deadline = Date.now() + 90000;
      while (!motorTestAbortRef.current && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        let result;
        try {
          result = await commandService.checkStatus(command.id);
        } catch {
          continue;
        }
        if (result?.status) lastStatus = result.status;
        if (result?.status === 'Executing') {
          setDeviceScanStatus('Pi received the motor test — motors should be moving now...');
        }
        if (result?.status === 'Executed') {
          setDeviceScanStatus('Motor test done — check that both motors actually moved.');
          return;
        }
        if (result?.status === 'Failed' || result?.status === 'Cancelled') {
          setDeviceScanStatus(`Motor test failed: ${result.errorMessage || result.status}`);
          return;
        }
      }
      if (!motorTestAbortRef.current) {
        setDeviceScanStatus(
          lastStatus === 'Executing'
            ? 'Pi started the motor test but never reported back. Check that both motors moved, then try again.'
            : 'The Pi never picked up the motor test (still Pending). Its live link is down or it runs old code — replug the USB into the Pi, restart the backend, then try again.',
        );
      }
    } catch (err) {
      setDeviceScanStatus(
        /pending .*command/i.test(err.message || '')
          ? `${err.message} Press Cancel Scan to clear it, then test again.`
          : toUserFacingError(err.message, 'Unable to send motor test command.'),
      );
    } finally {
      if (!motorTestAbortRef.current) setIsMotorTesting(false);
    }
  };

  useEffect(() => {
    if (!realtime) return undefined;
    return realtime.subscribe('camera_light', (message) => {
      if (device?.id && message.deviceId !== device.id) return;
      if (message.light) setLiveLight(message.light);
      if (message.command?.id) lightResultsRef.current.set(message.command.id, message.command);
    });
  }, [realtime, device?.id]);

  const sendCameraLight = async (payload) => {
    if (!device?.connected) {
      setLightStatus('Scanner is offline. Check Pi power and network, then wait for heartbeat.');
      return;
    }
    setIsLightBusy(true);
    setLightStatus('');
    lightCommandAtRef.current = Date.now();
    try {
      const command = await commandService.sendCameraLight(device.id || 'DEV-001', payload);
      const deadline = Date.now() + 15000;
      let nextHttpCheckAt = Date.now() + 1500;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        // The Pi pushes the result over the WebSocket; HTTP polling is only the fallback.
        let result = lightResultsRef.current.get(command.id);
        if (!result && Date.now() >= nextHttpCheckAt) {
          nextHttpCheckAt = Date.now() + 1500;
          try {
            result = await commandService.checkStatus(command.id);
          } catch {
            result = null;
          }
        }
        if (!result) continue;
        lightResultsRef.current.delete(command.id);
        if (result.status === 'Executed') {
          if (payload.scene != null) setLightStatus('Camera light colour changed.');
          else if (payload.brightness != null) setLightStatus(`Camera light brightness ${payload.brightness}%.`);
          else setLightStatus(payload.on === false ? 'Camera light off.' : 'Camera light on.');
          return;
        }
        if (result.status === 'Failed' || result.status === 'Cancelled') {
          setLightStatus(result.errorMessage || `Camera light command ${result.status.toLowerCase()}.`);
          return;
        }
      }
      setLightStatus('The Pi did not answer the light command. Replug the USB into the Pi so it runs the latest code.');
    } catch (err) {
      setLightStatus(toUserFacingError(err.message, 'Unable to send camera light command.'));
    } finally {
      setIsLightBusy(false);
    }
  };

  const reportedLightOn = cameraLightState.on;
  const reportedLightBrightness = cameraLightState.brightness;
  useEffect(() => {
    if (isLightBusy || lightDraggingRef.current) return;
    // Without live pushes only heartbeats arrive (up to ~15s late), so a just-sent setting must win.
    if (!liveLight && Date.now() - lightCommandAtRef.current < 20000) return;
    if (typeof reportedLightOn === 'boolean') setLightOn(reportedLightOn);
    if (typeof reportedLightBrightness === 'number') setLightBrightness(reportedLightBrightness);
  }, [reportedLightOn, reportedLightBrightness, isLightBusy, liveLight]);

  const handleLightToggle = (on) => {
    if (isLightBusy) return;
    setLightOn(on);
    sendCameraLight({ on });
  };

  const commitLightBrightness = () => {
    if (isLightBusy) return;
    sendCameraLight({ brightness: lightBrightness });
  };

  const handleLightColourChange = () => {
    if (isLightBusy) return;
    // The heartbeat's mode lags a few seconds, so keep cycling from the colour we just sent.
    const recent = Date.now() - lightCommandAtRef.current < 20000 && lightSceneIndexRef.current != null;
    const reported = CAMERA_LIGHT_SCENES.findIndex((s) => s.mode === cameraLightState.mode);
    // With live pushes the reported colour is current; otherwise keep cycling from the one just sent.
    const current = recent && !liveLight ? lightSceneIndexRef.current : reported;
    const next = (current + 1) % CAMERA_LIGHT_SCENES.length;
    lightSceneIndexRef.current = next;
    sendCameraLight({ scene: CAMERA_LIGHT_SCENES[next].scene });
  };

  // STEP 2 → STEP 3: Proceed to review
  const handleProceedToReview = (e) => {
    e.preventDefault();
    const validation = validateScannerDetails();
    if (!validation.isValid) {
      setFormErrors(validation.errors);
      setFormErrorSummary(validation.summary);
      return;
    }
    setFormErrors({});
    setFormErrorSummary('');
    setStep(3);
  };

  // STEP 3 → STEP 4: Confirm and submit
  const handleConfirmSubmit = async () => {
    const validation = validateScannerDetails();
    if (!validation.isValid) {
      setFormErrors(validation.errors);
      setFormErrorSummary(validation.summary);
      setStep(2);
      return;
    }
    setFormErrors({});
    setFormErrorSummary('');
    setIsSubmitting(true);

    try {
      const combinedPdf = await createScannedDocumentPdf(capturedImages, selectedPaperGuide);
      const filesToSave = [combinedPdf];
      if (hardwareScannedDoc?.id) {
        const scanOfficeId = hardwareScannedDoc.currentOfficeId
          || hardwareScannedDoc.originOfficeId
          || receptionOfficeId;
        await onEditDocument?.({
          id: hardwareScannedDoc.id,
          subject: formData.subject,
          documentDirection: 'Incoming',
          documentTypeId: formData.documentTypeId,
          documentTypeOther: formData.documentTypeOther,
          priorityLevel: 'normal',
          status: 'Received',
          dateReceived: formData.dateReceived,
          originOfficeId: receptionOfficeId || scanOfficeId,
          originOfficeOther: formData.originOfficeOther.trim(),
          destinationOfficeId: formData.toOfficeId,
          senderName: formData.senderName,
          senderContact: formData.senderContact,
          senderEmail: '',
          notifySender: formData.notifySender,
          senderNotificationConsent: formData.senderNotificationConsent,
          senderNotificationChannels: formData.senderContact ? ['sms'] : [],
          remarks: formData.remarks,
          scannedText: extractedText,
          scannedFiles: filesToSave,
          scannedImageUrl: filesToSave[0]?.url
            || filesToSave[0]?.previewUrl
            || hardwareScannedDoc.scannedImageUrl,
          intakeStatus: 'Approved',
        }, getInitialHandoffOfficeIds().length ? {
          fromOfficeId: receptionOfficeId,
          toOfficeIds: getInitialHandoffOfficeIds(),
          transmissionType: 'External',
        } : null);
        capturedImagesRef.current = filesToSave;
        setCapturedImages(filesToSave);
        setCapturedImage(combinedPdf.dataUrl);
        setCapturedFileType(combinedPdf.type);
        // Motors run only after Confirm & Register (not on Capture).
        if (device?.connected) {
          const sortLayer = resolveSortLayer(formData.documentTypeId);
          try {
            setDeviceScanStatus('Document registered — starting sorter motors...');
            setSortStatus({ state: 'running', message: `Sending sort command (tray layer ${sortLayer})...` });
            const sortCommand = await commandService.sendSort(device.id || 'DEV-001', {
              documentId: hardwareScannedDoc.id,
              documentTypeId: formData.documentTypeId,
              sortLayer,
            });
            setDeviceScanStatus('Sort command sent to physical scanner.');
            watchSortCommand(sortCommand.id, sortLayer);
          } catch (sortErr) {
            const message = toUserFacingError(
              sortErr?.message,
              'Document saved, but sorter command failed. Check Pi connection.',
            );
            setDeviceScanStatus(message);
            setSortStatus({ state: 'failed', message });
          }
        } else if (isPhysicalSource) {
          setSortStatus({ state: 'failed', message: 'Scanner is offline — the document was saved but not sorted.' });
        }
        setStep(4);
        return;
      }

      const newDoc = {
        subject: formData.subject,
        documentDirection: 'Incoming',
        documentTypeId: formData.documentTypeId,
        documentTypeOther: isOtherDocumentType(formData.documentTypeId) ? formData.documentTypeOther.trim() : '',
        priorityLevel: 'normal',
        status: 'Received',
        dateReceived: formData.dateReceived,
        originOfficeId: receptionOfficeId,
        originOfficeOther: formData.originOfficeOther.trim(),
        currentOfficeId: receptionOfficeId,
        destinationOfficeId: formData.toOfficeId,
        senderName: formData.senderName,
        senderContact: formData.senderContact,
        senderEmail: '',
        notifySender: formData.notifySender,
        senderNotificationConsent: formData.senderNotificationConsent,
        senderNotificationChannels: formData.senderContact ? ['sms'] : [],
        remarks: formData.remarks,
        scannedText: extractedText,
        scannedImageUrl: combinedPdf.dataUrl,
        scannedFiles: filesToSave,
        intakeStatus: 'Approved',
      };

      await onCapture?.(null, extractedText, newDoc);
      capturedImagesRef.current = filesToSave;
      setCapturedImages(filesToSave);
      setCapturedImage(combinedPdf.dataUrl);
      setCapturedFileType(combinedPdf.type);
      setStep(4);
    } catch (err) {
      setFormErrorSummary(err?.message || 'Unable to create or save the combined PDF.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRescan = () => {
    if (enrichPollRef.current) {
      clearInterval(enrichPollRef.current);
      enrichPollRef.current = null;
    }
    if (commandPollRef.current) {
      clearInterval(commandPollRef.current);
      commandPollRef.current = null;
    }
    commandPollBusyRef.current = false;
    appliedScanCommandsRef.current = new Set();
    setIsDeviceScanning(false);
    setIsSubjectExtracting(false);
    setEnrichmentHint('');
    setDeviceScanStatus('');
    setFormErrors({});
    setFormErrorSummary('');
    capturedImagesRef.current = [];
    setCapturedImages([]);
    setCapturedImage(null);
    setCapturedFileType('');
    setExtractedText('');
    setHardwareScannedDoc(null);
    setStep(1);
  };

  const handleReset = () => {
    sortPollAbortRef.current = true;
    setSortStatus(null);
    if (enrichPollRef.current) {
      clearInterval(enrichPollRef.current);
      enrichPollRef.current = null;
    }
    if (commandPollRef.current) {
      clearInterval(commandPollRef.current);
      commandPollRef.current = null;
    }
    commandPollBusyRef.current = false;
    appliedScanCommandsRef.current = new Set();
    autoFilledRef.current = {};
    setIsSubjectExtracting(false);
    setEnrichmentHint('');
    setStep(1);
    setCapturedImage(null);
    setCapturedFileType('');
    capturedImagesRef.current = [];
    setCapturedImages([]);
    setExtractedText('');
    setHardwareScannedDoc(null);
    setDeviceScanStatus('');
    setPreviewErrorMessage('');
    setFormData({
      subject: '',
      documentDirection: 'Incoming',
      documentTypeId: 'DT-001',
      documentTypeOther: '',
      status: 'Received',
      priorityLevel: 'normal',
      fromOfficeId: defaultSourceOfficeId,
      originOfficeOther: '',
      toOfficeId: getNextOfficeId(receptionOfficeId),
      dateReceived: new Date().toISOString().split('T')[0],
      senderName: '',
      senderContact: '',
      senderEmail: '',
      notifySender: true,
      senderNotificationConsent: true,
      senderNotificationChannels: ['sms', 'email'],
      remarks: '',
    });
    setFormErrors({});
    setFormErrorSummary('');
    setProgress(0);
  };

  const getOfficeName = (id) => {
    if (id === OTHER_OFFICE_VALUE) return formData.originOfficeOther || 'External / Other Office';
    const o = offices.find(x => x.id === id);
    return o ? o.name : 'Unknown';
  };

  const getDocTypeName = (id) => {
    const dt = documentTypes.find(x => x.id === id);
    if (dt?.category === 'Others' && formData.documentTypeOther) return formData.documentTypeOther;
    return dt ? dt.category : 'Unknown';
  };

  const requiresMayorApproval = Boolean(
    documentTypes.find((type) => type.id === formData.documentTypeId)?.requiresMayorApproval,
  );
  const getInitialHandoffOfficeIds = () => {
    const destinationOfficeId = formData.toOfficeId;
    if (!destinationOfficeId) return [];
    if (requiresMayorApproval && receptionOfficeId === mayorsOfficeId) return [];
    return requiresMayorApproval
      ? [...new Set([mayorsOfficeId, destinationOfficeId])]
      : [destinationOfficeId];
  };
  const getInitialHandoffLabel = () => (
    requiresMayorApproval ? "Mayor's Office for approval" : getOfficeName(formData.toOfficeId)
  );
  const selectedPriority = { color: 'var(--text-muted)', bg: 'transparent' };

  const stepLabels = [
    { num: 1, label: 'Scan Document' },
    { num: 2, label: 'Fill Details' },
    { num: 3, label: 'Review' },
    { num: 4, label: 'Complete' },
  ];

  return (
    <PageShell
      header={
        <div className="page-header">
          <div className="page-header-left">
            <h1>Scan Document</h1>
            <p>Scan first, then submit the document for intake review</p>
          </div>
          <div className={(device?.connected || hardwareScannedDoc) ? 'status-badge status-online' : 'status-badge status-offline'}>
            {(device?.connected || hardwareScannedDoc) ? <Wifi size={12} /> : <WifiOff size={12} />}
            {(device?.connected || hardwareScannedDoc) ? 'Physical Scanner Online' : 'Physical Scanner Offline'}
          </div>
        </div>
      }
    >
      {/* Step Indicator */}
      <nav className="scanner-progress" aria-label="Scan workflow steps">
        {stepLabels.map((s, i) => (
          <React.Fragment key={s.num}>
            <div className={`scanner-progress-step${step >= s.num ? ' is-active' : ''}${step > s.num ? ' is-done' : ''}`}>
              <div className="scanner-progress-badge" aria-hidden="true">
                {step > s.num ? <CheckCircle2 size={16} /> : s.num}
              </div>
              <span className="scanner-progress-label">{s.label}</span>
            </div>
            {i < stepLabels.length - 1 && (
              <div className={`scanner-progress-connector${step > s.num ? ' is-done' : ''}`} aria-hidden="true" />
            )}
          </React.Fragment>
        ))}
      </nav>

      {/* ============ STEP 1: Scan Document (FIRST!) ============ */}
      {step === 1 && (
        <div className="scanner-scan-page">
          <div className="scanner-scan-layout">
            <div className="card scanner-scan-main">
              <div className="scanner-preview-toolbar scanner-preview-toolbar--bar">
                <div className="scanner-preview-toolbar-group">
                  <label className="form-label" htmlFor="paper-guide-size">Paper guide</label>
                  <select
                    id="paper-guide-size"
                    className="form-select"
                    value={paperGuideId}
                    onChange={(e) => setPaperGuideId(e.target.value)}
                  >
                    {paperGuides.map((guide) => (
                      <option key={guide.id} value={guide.id}>{guide.label}</option>
                    ))}
                  </select>
                </div>
                <div className="scanner-preview-toolbar-group">
                  <label className="form-label" htmlFor="required-capture-count">Pages to capture</label>
                  <input
                    id="required-capture-count"
                    className="form-input"
                    type="number"
                    min="0"
                    max={MAX_SCAN_ATTACHMENTS}
                    inputMode="numeric"
                    value={pagesToCaptureInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        setPagesToCaptureInput('');
                        return;
                      }
                      if (!/^\d{1,3}$/.test(raw)) return;
                      const next = Number(raw);
                      if (next > MAX_SCAN_ATTACHMENTS) {
                        setPagesToCaptureInput(String(MAX_SCAN_ATTACHMENTS));
                        return;
                      }
                      setPagesToCaptureInput(raw);
                    }}
                    onBlur={commitPagesToCapture}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    disabled={isDeviceScanning || isExtracting || capturedImages.length > 0}
                  />
                </div>
                <label className="scanner-toggle-row scanner-toggle-row--inline">
                  <input
                    type="checkbox"
                    checked={showPaperGuide}
                    onChange={(e) => setShowPaperGuide(e.target.checked)}
                  />
                  <span>Show guide</span>
                </label>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm scanner-toolbar-refresh"
                  onClick={() => {
                    setStreamHasError(false);
                    setPreviewErrorMessage('');
                    setStreamReloadKey((value) => value + 1);
                  }}
                >
                  <RefreshCw size={15} />
                  Refresh
                </button>
              </div>

              <div className={previewShellClassName} style={previewShellStyle}>
              <canvas
                ref={previewCanvasRef}
                className={`scanner-live-stream scanner-live-canvas${directStreamUrl ? ' scanner-live-stream--hidden' : ''}`}
                aria-hidden={Boolean(directStreamUrl)}
              />
              <img
                key={`physical-preview-${streamReloadKey}`}
                ref={previewImgRef}
                className={`scanner-live-stream${directStreamUrl ? '' : ' scanner-live-stream--hidden'}`}
                decoding="async"
                src={directStreamUrl || undefined}
                alt="Physical scanner live preview"
                onLoad={() => {
                  if (directStreamUrl) {
                    const dimensions = {
                      width: previewImgRef.current?.naturalWidth || 0,
                      height: previewImgRef.current?.naturalHeight || 0,
                    };
                    if (dimensions.width && dimensions.height) {
                      setStreamDims(dimensions);
                    }
                    previewReadyRef.current = true;
                    setPreviewReady(true);
                    setPreviewMode('direct');
                    setStreamHasError(false);
                    setPreviewErrorMessage('');
                    lastFrameAtRef.current = Date.now();
                  }
                }}
                onError={() => {
                  if (directStreamUrl && hasLanBridge) {
                    setPreviewErrorMessage('MJPEG unavailable on Pi. Using LAN snapshot preview...');
                    lanSnapshotStarterRef.current?.();
                  }
                }}
              />

              {showPaperGuide && previewReady && (
                <div
                  key={paperGuideId}
                  className={`scanner-paper-overlay ${paperGuideLayout.overlayClass}`}
                  style={{ '--paper-ratio': paperGuideLayout.ratio }}
                >
                  <div className={`scanner-paper-frame ${paperGuideLayout.frameClass}`}>
                    <span className="scanner-paper-label">{selectedPaperGuide.label}</span>
                    <span className="scanner-corner corner-tl" />
                    <span className="scanner-corner corner-tr" />
                    <span className="scanner-corner corner-bl" />
                    <span className="scanner-corner corner-br" />
                  </div>
                </div>
              )}

              {isPhysicalSource && previewReady && !streamStale && (
                <div
                  className="scanner-stream-stats"
                  data-fps-tier={streamStats.paint >= 45 ? 'good' : streamStats.paint >= 25 ? 'ok' : 'low'}
                >
                  <span>{streamStats.paint} fps</span>
                  {device?.payload?.adaptiveStream && adaptiveStreamFps > 0 && (
                    <>
                      <span className="scanner-stream-stats-sep">·</span>
                      <span>cap {Math.round(adaptiveStreamFps)}</span>
                    </>
                  )}
                  {streamResolutionLabel && (
                    <>
                      <span className="scanner-stream-stats-sep">·</span>
                      <span>{streamResolutionLabel}</span>
                    </>
                  )}
                  <span className="scanner-stream-stats-sep">·</span>
                  <span>{previewLabel}</span>
                </div>
              )}

              {isPhysicalSource && previewReady && streamStale && (
                <div className="scanner-preview-overlay scanner-preview-overlay--reconnect">
                  <Loader2 size={28} className="animate-spin" />
                  <span>
                    {(device?.connected || device?.streamWsConnected)
                      ? 'Refreshing stream…'
                      : 'Reconnecting stream...'}
                  </span>
                </div>
              )}

              {isPhysicalSource && streamOnline && !previewReady && !streamHasError && (
                <div className="scanner-preview-overlay">
                  <CameraIcon size={32} />
                  <span>{previewErrorMessage || 'Connecting camera stream...'}</span>
                </div>
              )}

              {isPhysicalSource && !streamOnline && (
                <div className="scanner-preview-overlay scanner-preview-overlay--offline">
                  <div className="scanner-offline-icon">
                    <WifiOff size={28} />
                  </div>
                  <strong>Scanner offline</strong>
                  <span>Waiting for Pi heartbeat — check power and network</span>
                </div>
              )}

              {isPhysicalSource && streamHasError && !previewReady && (
                <div className="scanner-preview-overlay scanner-preview-overlay--error">
                  <AlertCircle size={28} />
                  <span>{previewErrorMessage || 'WebRTC preview is not ready yet.'}</span>
                </div>
              )}

              {isExtracting && (
                <div className="scanner-preview-overlay scanner-preview-overlay--extract">
                  <div className="scanner-extract-progress">
                    <div className="scanner-extract-progress-bar" style={{ width: `${progress}%` }} />
                  </div>
                  <p>Extracting text... {progress}%</p>
                </div>
              )}
            </div>
            </div>

            <aside className="card scanner-scan-sidebar">
              <div className={`scanner-scan-connection${(device?.connected || hardwareScannedDoc) ? ' is-online' : ' is-offline'}`}>
                {(device?.connected || hardwareScannedDoc) ? <Wifi size={18} /> : <WifiOff size={18} />}
                <div>
                  <strong>{(device?.connected || hardwareScannedDoc) ? 'Scanner ready' : 'Scanner offline'}</strong>
                  <p>
                    {(device?.connected || hardwareScannedDoc)
                      ? 'Live preview active. Align the document in the frame, then capture.'
                      : 'Start the Pi scanner service and wait for the device heartbeat.'}
                  </p>
                </div>
              </div>

              <ul className="scanner-scan-tips">
                <li>Close the door — the lift drops to layer 2 for capture</li>
                <li>Align the document in the live preview, then press Capture</li>
                <li>After Confirm &amp; Register, the lift goes to the tray layer, sorts, then returns to layer 2</li>
                <li>Open the door when done — the lift goes back up to layer 1</li>
              </ul>

              <div className="scanner-scan-actions">
                <button
                  onClick={() => {
                    if (isExtracting || isDeviceScanning) return;
                    if (isPhysicalSource && !device?.connected) {
                      setDeviceScanStatus('Scanner is offline. Check Pi power and network, then wait for heartbeat.');
                      return;
                    }
                    handleCapture();
                  }}
                  disabled={isExtracting || isDeviceScanning}
                  className="btn btn-primary scanner-capture-btn scanner-capture-btn--block"
                >
                  {isExtracting || isDeviceScanning ? <Loader2 className="animate-spin" /> : <Zap size={18} />}
                  {isExtracting
                    ? 'Processing...'
                    : requiredCaptureCount <= 1
                      ? 'Capture Document'
                      : `Capture ${Math.min(capturedImages.length + 1, requiredCaptureCount)} of ${requiredCaptureCount}`}
                </button>
                {(isDeviceScanning || /pending .*command|still busy/i.test(deviceScanStatus || '')) && (
                  <button
                    onClick={handleCancelPhysicalScan}
                    disabled={isExtracting}
                    className="btn btn-secondary scanner-capture-btn--block"
                  >
                    <XCircle size={18} />
                    Cancel Scan
                  </button>
                )}
                {isPhysicalSource && (
                  <button
                    onClick={handleMotorTest}
                    disabled={isMotorTesting || isDeviceScanning || isExtracting}
                    className="btn btn-secondary scanner-capture-btn--block"
                  >
                    {isMotorTesting ? <Loader2 size={18} className="animate-spin" /> : <RotateCw size={18} />}
                    {isMotorTesting ? 'Testing Motors...' : 'Test Motors'}
                  </button>
                )}
              </div>

              {deviceScanStatus && (
                <div className="scanner-device-status-banner">
                  <AlertCircle size={14} />
                  <span>{deviceScanStatus}</span>
                </div>
              )}

              {isPhysicalSource && (() => {
                const cameraLight = cameraLightState;
                return (
                  <div className="scanner-light-control">
                    <div className="scanner-light-control__header">
                      <span className="scanner-light-control__title">
                        <Lightbulb size={16} />
                        Camera light
                      </span>
                      <div className="scanner-light-control__toggle" role="group" aria-label="Camera light power">
                        <button
                          type="button"
                          onClick={() => handleLightToggle(true)}
                          disabled={isLightBusy}
                          className={`btn ${lightOn ? 'btn-primary' : 'btn-secondary'}`}
                          aria-pressed={lightOn}
                        >
                          On
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLightToggle(false)}
                          disabled={isLightBusy}
                          className={`btn ${!lightOn ? 'btn-primary' : 'btn-secondary'}`}
                          aria-pressed={!lightOn}
                        >
                          Off
                        </button>
                      </div>
                    </div>
                    <label className="scanner-light-control__slider">
                      <span>Brightness</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="2"
                        value={lightBrightness}
                        disabled={isLightBusy}
                        onChange={(e) => setLightBrightness(Number(e.target.value))}
                        onPointerDown={() => { lightDraggingRef.current = true; }}
                        onPointerUp={() => {
                          lightDraggingRef.current = false;
                          commitLightBrightness();
                        }}
                        onKeyUp={(e) => {
                          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
                            commitLightBrightness();
                          }
                        }}
                      />
                      <span className="scanner-light-control__value">
                        {isLightBusy ? <Loader2 size={14} className="animate-spin" /> : `${lightBrightness}%`}
                      </span>
                    </label>
                    <div className="scanner-light-control__colors">
                      <span>Colour</span>
                      <button type="button" onClick={handleLightColourChange} disabled={isLightBusy} className="btn btn-secondary">
                        Change colour
                      </button>
                    </div>
                    {cameraLight && !cameraLight.mapped && (
                      <p className="scanner-motor-diag__hint">
                        The Pi cannot reach the camera&apos;s light control yet. Replug the USB into the Pi to update it.
                        {cameraLight.probe?.hidError ? ` (${cameraLight.probe.hidError})` : ''}
                      </p>
                    )}
                    {lightStatus && <p className="scanner-light-control__status">{lightStatus}</p>}
                  </div>
                );
              })()}

            </aside>
          </div>
        </div>
      )}

      {/* ============ STEP 2: Fill Document Details ============ */}
      {step === 2 && (
        <div className="scanner-wide-panel">
          <div className="grid-2 scanner-detail-layout">
            {/* Left: Scanned Preview */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">
                  <ImageIcon size={18} style={{ color: 'var(--primary-light)' }} />
                  Scanned Document
                </h3>
              </div>
              {capturedImages.length ? (
                renderCapturedImageGallery('Scanned document')
              ) : (
                <div className="scanner-preview-empty" style={{ minHeight: '220px' }}>
                  <ImageIcon size={28} />
                  <span>No scanned preview available yet.</span>
                </div>
              )}
              {extractedText && (
                <div style={{
                  marginTop: '0.75rem', padding: '0.75rem',
                  background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)',
                  fontSize: '0.75rem', color: 'var(--text-muted)',
                  maxHeight: '150px', overflow: 'auto',
                  border: '1px solid var(--border-light)',
                }}>
                  <p style={{ fontWeight: 600, marginBottom: '0.25rem', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Extracted Text</p>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{extractedText}</p>
                </div>
              )}
            </div>

            {/* Right: Details Form */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">
                  <FileText size={18} style={{ color: 'var(--primary-light)' }} />
                  Document Details
                </h3>
              </div>

              <form onSubmit={handleProceedToReview} noValidate>
                <p className="form-required-note">Fields marked with <span className="required-mark">*</span> are required.</p>
                {formErrorSummary && (
                  <div className="form-error-summary" role="alert">{formErrorSummary}</div>
                )}
                <div className="form-group">
                  <label className="form-label">Document Subject <span className="required-mark">*</span></label>
                  <input
                    className={`form-input${formErrors.subject ? ' is-invalid' : ''}`}
                    type="text"
                    value={formData.subject}
                    onChange={e => handleFormChange('subject', e.target.value)}
                    placeholder={
                      formData.subject
                        ? 'e.g. Memorandum on Water Resource Management'
                        : (isSubjectExtracting
                          ? 'Extracting subject from scanned document...'
                          : 'Enter document subject')
                    }
                    aria-required="true"
                    autoFocus
                  />
                  {formErrors.subject && (
                    <p className="form-field-error">{formErrors.subject}</p>
                  )}
                  {enrichmentHint && (
                    <p className="form-hint" style={{ marginTop: '0.35rem', color: 'var(--warning)' }}>
                      {enrichmentHint}
                    </p>
                  )}
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Document Type</label>
                    <select className="form-select" value={formData.documentTypeId}
                      onChange={e => {
                        const nextTypeId = e.target.value;
                        handleFormChange('documentTypeId', nextTypeId);
                        if (!isOtherDocumentType(nextTypeId)) {
                          setFormErrors(prev => clearFieldError(prev, 'documentTypeOther'));
                        }
                      }}>
                      {documentTypes.map(dt => (
                        <option key={dt.id} value={dt.id}>{dt.category}</option>
                      ))}
                    </select>
                    {getSortLayerHint(formData.documentTypeId) && (
                      <p className="field-hint">{getSortLayerHint(formData.documentTypeId)}</p>
                    )}
                    {isOtherDocumentType(formData.documentTypeId) && (
                      <div className="form-group" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                        <label className="form-label">Specify Document Type <span className="required-mark">*</span></label>
                        <input
                          className={`form-input${formErrors.documentTypeOther ? ' is-invalid' : ''}`}
                          type="text"
                          value={formData.documentTypeOther}
                          onChange={e => handleFormChange('documentTypeOther', e.target.value)}
                          placeholder="Specify document type"
                          aria-required="true"
                        />
                        {formErrors.documentTypeOther && (
                          <p className="form-field-error">{formErrors.documentTypeOther}</p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Date Received</label>
                    <input className="form-input" type="date" value={formData.dateReceived}
                      disabled required />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Destination</label>
                  <select
                    className={`form-select${formErrors.toOfficeId ? ' is-invalid' : ''}`}
                    value={formData.toOfficeId}
                    onChange={e => handleFormChange('toOfficeId', e.target.value)}
                    required
                  >
                    <option value="">Select a destination office</option>
                    {offices.filter(office => office.id !== receptionOfficeId).map(office => (
                      <option key={office.id} value={office.id}>{office.name}</option>
                    ))}
                  </select>
                  {formErrors.toOfficeId && <p className="form-field-error">{formErrors.toOfficeId}</p>}
                  <p className="field-hint">If this document type requires Mayor approval, it will be sent there first, then forwarded to your selected destination after approval.</p>
                </div>

                {/* Sender Information */}
                <div style={{
                  padding: '0.75rem', background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)',
                  marginBottom: '0.75rem',
                }}>
                  <p style={{ fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                    <User size={12} style={{ display: 'inline', marginRight: '0.25rem' }} />
                    External Sender
                  </p>
                  <div className="form-group">
                    <label className="form-label">Sender Name <span className="required-mark">*</span></label>
                    <input
                      className={`form-input${formErrors.senderName ? ' is-invalid' : ''}`}
                      type="text"
                      value={formData.senderName}
                      onChange={e => handleFormChange('senderName', e.target.value)}
                      placeholder="Full name of the sender"
                      aria-required="true"
                    />
                    {formErrors.senderName && (
                      <p className="form-field-error">{formErrors.senderName}</p>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">
                      <Phone size={12} style={{ display: 'inline', marginRight: '0.25rem' }} />
                      Contact Number (Optional)
                    </label>
                    <input className="form-input" type="tel" value={formData.senderContact}
                      onChange={e => handleFormChange('senderContact', e.target.value)}
                      placeholder="09XX-XXX-XXXX" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">From Office / Organization (Optional)</label>
                    <input
                      className="form-input"
                      type="text"
                      value={formData.originOfficeOther}
                      onChange={e => handleFormChange('originOfficeOther', e.target.value)}
                      placeholder="School, agency, barangay, or organization"
                    />
                  </div>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={formData.notifySender}
                      onChange={e => setFormData({ ...formData, notifySender: e.target.checked })}
                    />
                    Send SMS tracking updates when a contact number is provided
                  </label>
                </div>

                <div className="form-group">
                    <label className="form-label">
                      <MessageSquare size={14} style={{ display: 'inline', marginRight: '0.25rem' }} />
                    Remarks / Notes <span className="optional-pill">Optional</span>
                  </label>
                  <textarea className="form-input" value={formData.remarks}
                    onChange={e => handleFormChange('remarks', e.target.value)}
                    placeholder="Additional notes or remarks about this document"
                    rows={2}
                    style={{ resize: 'vertical' }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={handleRescan}>
                    <ArrowLeft size={16} /> Re-scan
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                  >
                    Review & Submit <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ============ STEP 3: Review Before Submit ============ */}
      {step === 3 && (
        <div className="card scanner-review-card">
          <div className="card-header">
            <h3 className="card-title">
              <Eye size={18} style={{ color: 'var(--primary-light)' }} />
              Review Document Details
            </h3>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
            Please verify all information below before submitting. Captured pages will be combined into one PDF in capture order.
          </p>
          {formErrorSummary && (
            <div className="form-error-summary" role="alert">{formErrorSummary}</div>
          )}

          <div className="grid-2" style={{ gap: '1.25rem', marginBottom: '1.5rem' }}>
            {/* Scanned Preview */}
            <div>
              {capturedImages.length ? (
                renderCapturedImageGallery('Scanned document review')
              ) : null}
            </div>

            {/* Details Summary */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {[
                { label: 'Subject', value: formData.subject },
                { label: 'Type', value: getDocTypeName(formData.documentTypeId) },
                { label: 'Date Received', value: formData.dateReceived },
                { label: 'Destination', value: getOfficeName(formData.toOfficeId) },
                { label: 'Sender', value: formData.senderName },
                { label: 'Contact', value: formData.senderContact || '—' },
                { label: 'From Org', value: formData.originOfficeOther || '—' },
                { label: 'Remarks', value: formData.remarks || '—' },
              ].map((item, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                  padding: '0.5rem 0.75rem',
                  background: i % 2 === 0 ? 'var(--bg-elevated)' : 'transparent',
                  borderRadius: 'var(--radius-sm)', fontSize: '0.82rem',
                }}>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 500, minWidth: '90px' }}>{item.label}</span>
                  <span style={{
                    color: item.color || 'var(--text-main)', fontWeight: 600,
                    textAlign: 'right', maxWidth: '250px', wordBreak: 'break-word',
                  }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Route Preview */}
          <div style={{
            padding: '1rem',
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-light)',
            marginBottom: '1.5rem',
          }}>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
              Forward Path
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'center' }}>
              <span style={{
                padding: '0.375rem 0.75rem', borderRadius: 'var(--radius-sm)',
                background: 'var(--primary-glow)', color: 'var(--primary-light)',
                fontSize: '0.8rem', fontWeight: 600,
              }}>
                External Sender
              </span>
              <ArrowRight size={18} style={{ color: 'var(--primary-light)' }} />
              <span style={{
                padding: '0.375rem 0.75rem', borderRadius: 'var(--radius-sm)',
                background: 'var(--success-bg)', color: 'var(--success)',
                fontSize: '0.8rem', fontWeight: 600,
              }}>
                {getInitialHandoffLabel()}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-secondary" onClick={() => setStep(2)}>
              <ArrowLeft size={16} /> Edit Details
            </button>
            <button className="btn btn-primary" onClick={handleConfirmSubmit} disabled={isSubmitting} style={{ padding: '0.75rem 2rem' }}>
              <Send size={16} /> {isSubmitting ? 'Saving…' : 'Confirm & Register'}
            </button>
          </div>
        </div>
      )}

      {/* ============ STEP 4: Complete ============ */}
      {step === 4 && (
        <div className="card" style={{ maxWidth: '500px', margin: '0 auto', textAlign: 'center', padding: '3rem 2rem' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: 'var(--success-bg)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem',
          }}>
            <CheckCircle2 size={32} style={{ color: 'var(--success)' }} />
          </div>

          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem', color: 'var(--text-main)' }}>
            Document Registered
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            {requiresMayorApproval
              ? receptionOfficeId === mayorsOfficeId
                ? `The scan was recorded at the Mayor's Office for approval. ${getOfficeName(formData.toOfficeId)} remains the requested destination.`
                : `The scan was saved at Reception and sent to the Mayor's Office for approval. ${getOfficeName(formData.toOfficeId)} remains the requested destination.`
              : `The scan was saved at Reception and sent to ${getOfficeName(formData.toOfficeId)} for receipt.`}
          </p>

          {sortStatus && (
            <div className={`scanner-sort-status scanner-sort-status--${sortStatus.state}`}>
              {sortStatus.state === 'running' && <Loader2 size={16} className="animate-spin" />}
              {sortStatus.state === 'done' && <CheckCircle2 size={16} />}
              {sortStatus.state === 'failed' && <AlertCircle size={16} />}
              <span>{sortStatus.message}</span>
            </div>
          )}

          <div style={{
            padding: '1rem', background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-md)', marginBottom: '1.5rem',
            textAlign: 'left',
          }}>
            {[
              { label: 'Subject', value: formData.subject },
              { label: 'Sender', value: formData.senderName },
              { label: 'Destination', value: getOfficeName(formData.toOfficeId) },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: i < 3 ? '0.5rem' : 0, fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{item.label}</span>
                <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{item.value}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
            <button onClick={handleReset} className="btn btn-primary">
              <Scan size={16} /> Scan Another
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes scan-move {
          0% { top: 0% }
          100% { top: 100% }
        }
      `}</style>
    </PageShell>
  );
};

export default Scanner;
