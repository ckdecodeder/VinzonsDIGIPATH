import React, { useEffect, useRef, useState } from "react";
import PageShell from "./PageShell";
import PdfFitPreview from "./PdfFitPreview";
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
  Image,
  Wifi,
  WifiOff,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Camera } from "react-camera-pro";
import Tesseract from "tesseract.js";
import { resolveUploadUrl, isPdfMedia } from "../utils/mediaUrl";
import { commandService, bridgeService } from "../api/documentService";
import { useOptionalRealtime } from "../context/RealtimeContext";
import { resolveReachableLanBridge } from "../utils/bridgePreview";
import {
  offices as defaultOffices,
  documentTypes as defaultDocumentTypes,
  priorityLevels,
  getPriorityInfo,
} from "../data/mockData";

const OTHER_OFFICE_VALUE = '__external_source__';
const PHYSICAL_CAMERA_VALUE = 'physical-scanner';

const paperGuides = [
  { id: 'letter-landscape', label: 'Letter Landscape', ratio: '11 / 8.5' },
  { id: 'legal-landscape', label: 'Legal Landscape', ratio: '14 / 8.5' },
  { id: 'a4-landscape', label: 'A4 Landscape', ratio: '297 / 210' },
  { id: 'id-landscape', label: 'ID / Card', ratio: '1.586 / 1' },
  { id: 'receipt-landscape', label: 'Receipt', ratio: '2.6 / 1' },
];

const WS_STREAM_TIMEOUT_MS = 500;
const SNAPSHOT_INTERVAL_MS = 400;
const STREAM_STALE_MS = 4000;

const paintWsFrame = (previewImg, frame, wsFrameUrlRef, onReady) => {
  if (!frame?.length || !previewImg) return;
  const blob = new Blob([frame], { type: 'image/jpeg' });
  const nextUrl = URL.createObjectURL(blob);
  if (wsFrameUrlRef.current) {
    URL.revokeObjectURL(wsFrameUrlRef.current);
  }
  wsFrameUrlRef.current = nextUrl;
  previewImg.decoding = 'sync';
  previewImg.src = nextUrl;
  onReady?.();
};

const getSubjectFromOcr = (text, fallback = '') => {
  const lines = (text || '')
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim().replace(/^[-_:;,.]+|[-_:;,.]+$/g, ''))
    .filter(line => line.length >= 6 && /[A-Za-z]/.test(line));

  const subjectLine = lines.find(line => /^subject\s*:/i.test(line));
  if (subjectLine) {
    const subject = subjectLine.replace(/^subject\s*:\s*/i, '').trim();
    if (subject) return subject.slice(0, 120);
  }

  return (lines[0] || fallback || 'Scanned Document').slice(0, 120);
};

const Scanner = ({ onCapture, onEditDocument, currentUser, offices = defaultOffices, documentTypes = defaultDocumentTypes, device }) => {
  const camera = useRef(null);
  const commandPollRef = useRef(null);
  const previewImgRef = useRef(null);
  const wsFrameUrlRef = useRef('');
  const previewReadyRef = useRef(false);
  const lanSnapshotStarterRef = useRef(null);
  const lastFrameAtRef = useRef(0);
  const staleReloadAtRef = useRef(0);
  const realtime = useOptionalRealtime();
  const canChooseSourceOffice = currentUser?.role === 'Admin';
  const canChooseDirection = currentUser?.role === 'Admin';
  const canSetInitialStatus = currentUser?.role === 'Receptionist' || currentUser?.role === 'Admin';
  const defaultSourceOfficeId = currentUser?.officeId || offices[0]?.id || 'OFF-001';
  const getNextOfficeId = (fromOfficeId) => offices.find(o => o.id !== fromOfficeId)?.id || fromOfficeId;
  const isOtherDocumentType = (typeId) => {
    const docType = documentTypes.find(item => item.id === typeId);
    return docType?.category?.toLowerCase().includes('other');
  };
  // Step 1 = Scan, Step 2 = Fill Details, Step 3 = Review, Step 4 = Done
  const [step, setStep] = useState(1);
  const [numberOfCameras, setNumberOfCameras] = useState(0);
  const [cameraDevices, setCameraDevices] = useState([]);
  const [cameraSource, setCameraSource] = useState(PHYSICAL_CAMERA_VALUE);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [cameraFacingMode, setCameraFacingMode] = useState('environment');
  const [paperGuideId, setPaperGuideId] = useState('letter-landscape');
  const [streamReloadKey, setStreamReloadKey] = useState(0);
  const [previewErrorMessage, setPreviewErrorMessage] = useState('');
  const [streamHasError, setStreamHasError] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [lanBridgeBase, setLanBridgeBase] = useState(null);
  const [lanBridgeProbing, setLanBridgeProbing] = useState(false);
  const [directStreamUrl, setDirectStreamUrl] = useState('');
  const [previewMode, setPreviewMode] = useState('ws');
  const [streamStale, setStreamStale] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDeviceScanning, setIsDeviceScanning] = useState(false);
  const [deviceScanStatus, setDeviceScanStatus] = useState('');

  // Scan results
  const [capturedImage, setCapturedImage] = useState(null);
  const [capturedFileType, setCapturedFileType] = useState('');
  const [extractedText, setExtractedText] = useState('');
  const [hardwareScannedDoc, setHardwareScannedDoc] = useState(null);

  // Document form state (filled AFTER scanning)
  const [formData, setFormData] = useState({
    subject: '',
    documentDirection: 'Incoming',
    documentTypeId: 'DT-001',
    documentTypeOther: '',
    status: 'Received',
    priorityLevel: 'normal',
    fromOfficeId: defaultSourceOfficeId,
    originOfficeOther: '',
    toOfficeId: getNextOfficeId(defaultSourceOfficeId),
    dateReceived: new Date().toISOString().split('T')[0],
    senderName: '',
    senderContact: '',
    senderEmail: '',
    notifySender: true,
    senderNotificationConsent: true,
    senderNotificationChannels: ['sms', 'email'],
    remarks: '',
  });

  useEffect(() => {
    refreshCameraDevices();

    return () => {
      if (commandPollRef.current) {
        clearInterval(commandPollRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!device?.connected && cameraSource === PHYSICAL_CAMERA_VALUE) {
      setCameraSource(selectedCameraId || 'browser-camera');
    }
    if (device?.connected && (!cameraSource || cameraSource === 'browser-camera')) {
      setCameraSource(PHYSICAL_CAMERA_VALUE);
    }
  }, [device?.connected]);

  const refreshCameraDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(item => item.kind === 'videoinput');
      setCameraDevices(videoInputs);
      if (!selectedCameraId && videoInputs[0]?.deviceId) {
        setSelectedCameraId(videoInputs[0].deviceId);
      }
    } catch {
      setCameraDevices([]);
    }
  };

  const handleFormChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
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

  const isPhysicalSource = cameraSource === PHYSICAL_CAMERA_VALUE;
  const hasLanBridge = Boolean(isPhysicalSource && device?.connected && lanBridgeBase);
  const previewLabel = previewMode === 'direct'
    ? 'Live via Pi LAN (MJPEG)'
    : previewMode === 'lan-snapshot'
      ? 'Live via Pi LAN (snapshot)'
      : previewMode === 'ws'
        ? 'Live via WebSocket'
        : 'Live via Pi snapshot';
  const selectedPaperGuide = paperGuides.find(item => item.id === paperGuideId) || paperGuides[0];
  const isCapturedPdf = isPdfMedia(capturedImage, capturedFileType);

  useEffect(() => {
    if (!isPhysicalSource) {
      setStreamHasError(false);
      setPreviewErrorMessage('');
      return undefined;
    }

    if (!device?.connected) {
      setStreamHasError(true);
      setPreviewErrorMessage('Physical scanner is offline. Wait for device heartbeat.');
      return undefined;
    }

    if (hasLanBridge) {
      setStreamHasError(false);
      setPreviewErrorMessage(previewReady ? '' : 'Connecting to Pi camera on LAN...');
      return undefined;
    }

    if (lanBridgeProbing) {
      setStreamHasError(false);
      setPreviewErrorMessage('Checking for Pi on local network...');
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
    setPreviewErrorMessage('Connecting WebSocket camera stream...');
    return undefined;
  }, [isPhysicalSource, device?.connected, realtime?.connected, previewReady, streamReloadKey, hasLanBridge, lanBridgeProbing]);

  useEffect(() => {
    if (!isPhysicalSource || !device?.connected) {
      setLanBridgeBase(null);
      setLanBridgeProbing(false);
      return undefined;
    }

    let cancelled = false;
    setLanBridgeProbing(true);
    setLanBridgeBase(null);

    resolveReachableLanBridge(device).then((base) => {
      if (cancelled) return;
      setLanBridgeBase(base);
      setLanBridgeProbing(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isPhysicalSource, device?.connected, device?.bridgeUrl, device?.streamUrl, device?.id, device?.ip, device?.payload?.ip, streamReloadKey]);

  const paintPreviewBlob = (blob) => {
    const nextUrl = URL.createObjectURL(blob);
    if (wsFrameUrlRef.current) {
      URL.revokeObjectURL(wsFrameUrlRef.current);
    }
    wsFrameUrlRef.current = nextUrl;
    if (previewImgRef.current) {
      previewImgRef.current.src = nextUrl;
    }
    lastFrameAtRef.current = Date.now();
    if (!previewReadyRef.current) {
      previewReadyRef.current = true;
      setPreviewReady(true);
    }
    setStreamStale(false);
    setStreamHasError(false);
    setPreviewErrorMessage('');
  };

  useEffect(() => {
    previewReadyRef.current = false;
    setPreviewReady(false);
    setStreamStale(false);
    lastFrameAtRef.current = 0;
    setDirectStreamUrl('');
    if (wsFrameUrlRef.current) {
      URL.revokeObjectURL(wsFrameUrlRef.current);
      wsFrameUrlRef.current = '';
    }
    if (previewImgRef.current) {
      previewImgRef.current.removeAttribute('src');
    }
  }, [streamReloadKey, device?.id, cameraSource]);

  useEffect(() => {
    // MJPEG (direct) is a continuous browser-managed stream; per-frame timing
    // is not observable, so skip the watchdog for it.
    if (!isPhysicalSource || !device?.connected || !previewReady || previewMode === 'direct') {
      setStreamStale(false);
      return undefined;
    }

    const interval = setInterval(() => {
      const last = lastFrameAtRef.current;
      if (!last) return;
      const age = Date.now() - last;
      if (age < STREAM_STALE_MS) {
        setStreamStale(false);
        return;
      }

      setStreamStale(true);

      // Auto-recover: reload the stream at most once every 8s while stalled.
      const now = Date.now();
      if (now - staleReloadAtRef.current > 8000) {
        staleReloadAtRef.current = now;
        setStreamReloadKey(value => value + 1);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isPhysicalSource, device?.connected, previewReady, previewMode, directStreamUrl]);

  useEffect(() => {
    if (!hasLanBridge) {
      setDirectStreamUrl('');
      return undefined;
    }

    let cancelled = false;
    let snapshotTimer = null;
    const lanBase = lanBridgeBase;

    const deviceId = device?.id || 'DEV-001';

    const startLanSnapshotPolling = () => {
      if (cancelled || snapshotTimer) return;
      setDirectStreamUrl('');
      setPreviewMode('lan-snapshot');

      const pollLanSnapshot = async () => {
        try {
          const blob = await bridgeService.snapshot({ deviceId, bridgeUrl: lanBase });
          if (cancelled || !blob?.size) return;
          paintPreviewBlob(blob);
        } catch (err) {
          if (!cancelled && !previewReadyRef.current) {
            setStreamHasError(true);
            setPreviewErrorMessage(`LAN camera preview failed: ${err.message || 'snapshot unavailable'}`);
          }
        }
      };

      pollLanSnapshot();
      snapshotTimer = setInterval(pollLanSnapshot, SNAPSHOT_INTERVAL_MS);
    };

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
        // MJPEG unavailable on Pi — use snapshot polling instead.
      }

      if (!cancelled) startLanSnapshotPolling();
    };

    probeLanStream();
    lanSnapshotStarterRef.current = startLanSnapshotPolling;

    return () => {
      cancelled = true;
      lanSnapshotStarterRef.current = null;
      if (snapshotTimer) clearInterval(snapshotTimer);
    };
  }, [hasLanBridge, lanBridgeBase, streamReloadKey, device?.id]);

  const scheduleFramePaint = (frame) => {
    if (!frame?.length || !previewImgRef.current) return;
    paintWsFrame(previewImgRef.current, frame, wsFrameUrlRef, () => {
      lastFrameAtRef.current = Date.now();
      setStreamStale(false);
      if (!previewReadyRef.current) {
        previewReadyRef.current = true;
        setPreviewReady(true);
        setPreviewMode('ws');
        setStreamHasError(false);
        setPreviewErrorMessage('');
      }
    });
  };

  useEffect(() => {
    if (!isPhysicalSource || !device?.connected || !realtime?.client || hasLanBridge) {
      return undefined;
    }

    const deviceId = device.id || 'DEV-001';
    const channel = `scanner:${deviceId}:stream`;
    let streamTimeout = null;

    const bindStream = () => {
      realtime.subscribeChannel(channel);
    };

    bindStream();
    const offOpen = realtime.subscribe('connection:open', bindStream);

    const offFrame = realtime.subscribe('scanner:frame', ({ frame }) => {
      scheduleFramePaint(frame);
      if (streamTimeout) {
        clearTimeout(streamTimeout);
        streamTimeout = null;
      }
    });

    streamTimeout = setTimeout(() => {
      if (!previewReadyRef.current) {
        setStreamHasError(true);
        setPreviewErrorMessage(device?.streamWsConnected === false
          ? 'Pi WebSocket stream is offline. Trying snapshot preview from the bridge...'
          : 'WebSocket camera stream unavailable. Trying snapshot preview from the bridge...');
      }
    }, WS_STREAM_TIMEOUT_MS);

    return () => {
      offOpen();
      offFrame();
      if (streamTimeout) clearTimeout(streamTimeout);
      realtime.client.unsubscribe(channel);
      if (wsFrameUrlRef.current) {
        URL.revokeObjectURL(wsFrameUrlRef.current);
        wsFrameUrlRef.current = '';
      }
    };
  }, [isPhysicalSource, device?.connected, device?.id, device?.streamWsConnected, realtime, realtime?.connected, streamReloadKey, hasLanBridge]);

  useEffect(() => {
    if (!isPhysicalSource || !device?.connected || previewReady || hasLanBridge || lanBridgeProbing) {
      return undefined;
    }

    let cancelled = false;
    let snapshotTimer = null;
    const deviceId = device.id || 'DEV-001';

    const loadSnapshotPreview = async () => {
      try {
        const bridgeStatus = await bridgeService.status({ deviceId });
        if (cancelled) return;
        if (!bridgeStatus?.ok) {
          if (!previewReadyRef.current) {
            setStreamHasError(true);
            setPreviewErrorMessage(
              device?.streamWsConnected === false
                ? 'Waiting for Pi WebSocket stream via public backend. Ensure dev tunnel port 5000 is public and run: bash scripts/pi-test-backend.sh on the Pi.'
                : 'WebSocket stream still connecting. If this persists, restart digipath-scanner on the Pi.',
            );
          }
          return;
        }

        const blob = await bridgeService.snapshot({
          deviceId,
          bridgeUrl: bridgeStatus.bridgeUrl,
        });
        if (cancelled || !blob) return;

        const nextUrl = URL.createObjectURL(blob);
        if (wsFrameUrlRef.current) {
          URL.revokeObjectURL(wsFrameUrlRef.current);
        }
        wsFrameUrlRef.current = nextUrl;
        if (previewImgRef.current) {
          previewImgRef.current.src = nextUrl;
        }
        if (!previewReadyRef.current) {
          previewReadyRef.current = true;
          setPreviewReady(true);
        }
        setPreviewMode('snapshot');
        setStreamHasError(false);
        setPreviewErrorMessage('');
      } catch (err) {
        if (!cancelled && !previewReadyRef.current) {
          setStreamHasError(true);
          setPreviewErrorMessage(
            `Camera preview unavailable: ${err.message || 'bridge snapshot failed'}. Same WiFi as Pi enables faster LAN preview.`,
          );
        }
      }
    };

    const startAfter = setTimeout(() => {
      loadSnapshotPreview();
      snapshotTimer = setInterval(loadSnapshotPreview, SNAPSHOT_INTERVAL_MS);
    }, WS_STREAM_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(startAfter);
      if (snapshotTimer) clearInterval(snapshotTimer);
    };
  }, [isPhysicalSource, device?.connected, device?.id, device?.streamWsConnected, previewReady, streamReloadKey, hasLanBridge, lanBridgeProbing]);

  const handleCameraSourceChange = (value) => {
    setCameraSource(value);
    setStreamHasError(false);
    setPreviewErrorMessage('');
    if (value !== PHYSICAL_CAMERA_VALUE) {
      setSelectedCameraId(value === 'browser-camera' ? '' : value);
    }
  };

  const applyPhysicalScanResult = (result) => {
    if (result.status === 'Executed') {
      const doc = result.resultDocument;
      setHardwareScannedDoc(doc || null);
      if (doc) {
        const scannedFile = doc.scannedFiles?.[0];
        const scannedUrl = resolveUploadUrl(
          doc.scannedImageUrl || scannedFile?.url || scannedFile?.dataUrl || null,
        );
        const scannedType = scannedFile?.type || (isPdfMedia(scannedUrl) ? 'application/pdf' : '');
        setCapturedImage(scannedUrl);
        setCapturedFileType(scannedType);
        setExtractedText(doc.scannedText || '');
        setFormData(prev => ({
          ...prev,
          subject: getSubjectFromOcr(doc.scannedText || '', doc.subject) || prev.subject,
          documentDirection: doc.documentDirection || prev.documentDirection,
          documentTypeId: doc.documentTypeId || prev.documentTypeId,
          documentTypeOther: doc.documentTypeOther || prev.documentTypeOther,
          status: doc.status || prev.status,
          priorityLevel: doc.priorityLevel || prev.priorityLevel,
          fromOfficeId: doc.currentOfficeId || doc.originOfficeId || prev.fromOfficeId,
          originOfficeOther: doc.originOfficeOther || prev.originOfficeOther,
          toOfficeId: doc.destinationOfficeId || prev.toOfficeId,
          dateReceived: doc.dateReceived || prev.dateReceived,
          senderName: doc.senderName && doc.senderName !== 'Scanner Device' ? doc.senderName : prev.senderName,
          senderContact: doc.senderContact || prev.senderContact,
          senderEmail: doc.senderEmail || prev.senderEmail,
          notifySender: doc.notifySender ?? prev.notifySender,
          senderNotificationConsent: doc.senderNotificationConsent ?? prev.senderNotificationConsent,
          senderNotificationChannels: doc.senderNotificationChannels?.length ? doc.senderNotificationChannels : prev.senderNotificationChannels,
          remarks: doc.remarks || prev.remarks,
        }));
      }
      setIsDeviceScanning(false);
      setDeviceScanStatus('');
      setStep(2);
      return true;
    }

    if (result.status === 'Failed' || result.status === 'Cancelled') {
      setIsDeviceScanning(false);
      setDeviceScanStatus(result.errorMessage || `Physical scanner command ${result.status.toLowerCase()}.`);
      return true;
    }

    return false;
  };

  // STEP 1: Capture/scan the document
  const handleCapture = async () => {
    if (isPhysicalSource) {
      await handlePhysicalScan();
      return;
    }

    if (!camera.current?.takePhoto) {
      setDeviceScanStatus('Camera is not ready yet. Please wait a moment and try again.');
      return;
    }

    const photo = camera.current.takePhoto();
    setCapturedImage(photo);
    setCapturedFileType('image/jpeg');
    setIsExtracting(true);
    setProgress(0);

    try {
      const { data: { text } } = await Tesseract.recognize(photo, 'eng', {
        logger: m => {
          if (m.status === 'recognizing text') {
            setProgress(parseInt(m.progress * 100));
          }
        }
      });
      setExtractedText(text);
      setFormData(prev => ({
        ...prev,
        subject: prev.subject || getSubjectFromOcr(text),
      }));
    } catch (err) {
      console.error("OCR Error:", err);
      setExtractedText('');
    } finally {
      setIsExtracting(false);
      setStep(2); // Move to details form
    }
  };

  const handlePhysicalScan = async () => {
    if (!device?.connected) {
      setDeviceScanStatus('Physical scanner is offline. Wait for the device heartbeat before sending a scan command.');
      return;
    }

    setIsDeviceScanning(true);
    setDeviceScanStatus('Sending scan command to physical scanner...');
    setHardwareScannedDoc(null);

    try {
      const command = await commandService.sendScan(device.id || 'DEV-001', {
        officeId: formData.fromOfficeId === OTHER_OFFICE_VALUE ? defaultSourceOfficeId : formData.fromOfficeId,
        originOfficeOther: formData.originOfficeOther,
        status: canSetInitialStatus ? formData.status : 'Received',
        priorityLevel: formData.priorityLevel,
        documentTypeId: formData.documentTypeId,
      });
      setDeviceScanStatus('Waiting for the physical scanner to capture and upload the document...');

      let attempts = 0;
      commandPollRef.current = setInterval(async () => {
        attempts += 1;
        try {
          const result = await commandService.checkStatus(command.id);
          if (applyPhysicalScanResult(result)) {
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
        }
      }, 2000);
    } catch (err) {
      setIsDeviceScanning(false);
      const isPendingConflict = /pending command/i.test(err.message || '');
      setDeviceScanStatus(
        isPendingConflict
          ? 'The Pi still has a pending scan. Click Cancel Scan or wait about 1 minute.'
          : (err.message || 'Unable to send scan command.'),
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
      setDeviceScanStatus(err.message || 'Unable to cancel scan command.');
    }
  };

  // STEP 2 → STEP 3: Proceed to review
  const handleProceedToReview = (e) => {
    e.preventDefault();
    setStep(3);
  };

  // STEP 3 → STEP 4: Confirm and submit
  const handleConfirmSubmit = async () => {
    if (hardwareScannedDoc?.id) {
      await onEditDocument?.({
        ...hardwareScannedDoc,
        subject: formData.subject,
        documentDirection: canChooseDirection ? formData.documentDirection : 'Incoming',
        documentTypeId: formData.documentTypeId,
        documentTypeOther: formData.documentTypeOther,
        priorityLevel: formData.priorityLevel,
        status: canSetInitialStatus ? formData.status : 'Received',
        dateReceived: formData.dateReceived,
        senderName: formData.senderName,
        senderContact: formData.senderContact,
        senderEmail: formData.senderEmail,
        notifySender: formData.notifySender,
        senderNotificationConsent: formData.senderNotificationConsent,
        senderNotificationChannels: formData.senderNotificationChannels,
        remarks: formData.remarks,
        scannedText: extractedText,
      });
      setStep(4);
      return;
    }

    const sourceOfficeId = formData.fromOfficeId === OTHER_OFFICE_VALUE ? defaultSourceOfficeId : formData.fromOfficeId;
    const newDoc = {
      subject: formData.subject,
      documentDirection: canChooseDirection ? formData.documentDirection : 'Incoming',
      documentTypeId: formData.documentTypeId,
      documentTypeOther: isOtherDocumentType(formData.documentTypeId) ? formData.documentTypeOther.trim() : '',
      priorityLevel: formData.priorityLevel,
      status: canSetInitialStatus ? formData.status : 'Received',
      dateReceived: formData.dateReceived,
      originOfficeId: sourceOfficeId,
      originOfficeOther: formData.fromOfficeId === OTHER_OFFICE_VALUE ? formData.originOfficeOther.trim() : '',
      currentOfficeId: sourceOfficeId,
      destinationOfficeId: formData.toOfficeId,
      senderName: formData.senderName,
      senderContact: formData.senderContact,
      senderEmail: formData.senderEmail,
      notifySender: formData.notifySender,
      senderNotificationConsent: formData.senderNotificationConsent,
      senderNotificationChannels: formData.senderNotificationChannels,
      remarks: formData.remarks,
      scannedText: extractedText,
      scannedImageUrl: capturedImage,
      scannedFiles: [],
      intakeStatus: 'Pending Review',
    };

    const newTransmission = {
      fromOfficeId: sourceOfficeId,
      toOfficeId: formData.toOfficeId,
      transmissionDate: formData.dateReceived,
      transmissionType: formData.fromOfficeId === formData.toOfficeId ? 'Internal' : 'External',
    };

    onCapture(capturedImage, extractedText, newDoc, newTransmission);
    setStep(4);
  };

  const handleReset = () => {
    setStep(1);
    setCapturedImage(null);
    setCapturedFileType('');
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
      toOfficeId: getNextOfficeId(defaultSourceOfficeId),
      dateReceived: new Date().toISOString().split('T')[0],
      senderName: '',
      senderContact: '',
      senderEmail: '',
      notifySender: true,
      senderNotificationConsent: true,
      senderNotificationChannels: ['sms', 'email'],
      remarks: '',
    });
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
  const selectedPriority = getPriorityInfo(formData.priorityLevel);

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
          <div className={device?.connected ? 'status-badge status-online' : 'status-badge status-offline'}>
            {device?.connected ? <Wifi size={12} /> : <WifiOff size={12} />}
            {device?.connected ? 'Physical Scanner Online' : 'Physical Scanner Offline'}
          </div>
        </div>
      }
    >
      {/* Step Indicator */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: '0.5rem', marginBottom: '1.5rem',
      }}>
        {stepLabels.map((s, i) => (
          <React.Fragment key={s.num}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
            }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.8rem', fontWeight: 700,
                background: step >= s.num ? 'var(--gradient-primary)' : 'var(--bg-elevated)',
                color: step >= s.num ? 'white' : 'var(--text-muted)',
                border: step >= s.num ? 'none' : '1px solid var(--border)',
                transition: 'all 0.3s',
              }}>
                {step > s.num ? <CheckCircle2 size={16} /> : s.num}
              </div>
              <span style={{
                fontSize: '0.8rem', fontWeight: 500,
                color: step >= s.num ? 'var(--text-main)' : 'var(--text-muted)',
              }}>
                {s.label}
              </span>
            </div>
            {i < 3 && (
              <div style={{
                width: '50px', height: '2px',
                background: step > s.num ? 'var(--primary)' : 'var(--border)',
                borderRadius: '1px', transition: 'background 0.3s',
              }}></div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* ============ STEP 1: Scan Document (FIRST!) ============ */}
      {step === 1 && (
        <div className="card" style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <Scan style={{ color: 'var(--primary-light)' }} />
            Scan Document
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Position the document in front of the camera and capture it
          </p>

          <div className="scanner-camera-controls">
            <div className="form-group" style={{ marginBottom: 0, textAlign: 'left' }}>
              <label className="form-label">Camera Source</label>
              <select
                className="form-select"
                value={cameraSource}
                onChange={e => handleCameraSourceChange(e.target.value)}
              >
                {device?.connected && (
                  <option value={PHYSICAL_CAMERA_VALUE}>Physical Scanner Live Preview</option>
                )}
                {cameraDevices.length ? cameraDevices.map((item, index) => (
                  <option key={item.deviceId || index} value={item.deviceId}>
                    {item.label || `Camera ${index + 1}`}
                  </option>
                )) : (
                  <option value="browser-camera">Default browser camera</option>
                )}
              </select>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (isPhysicalSource) {
                  setStreamHasError(false);
                  setPreviewErrorMessage('');
                  setStreamReloadKey(value => value + 1);
                  return;
                }
                if (camera.current?.switchCamera && numberOfCameras > 1) {
                  const nextMode = camera.current.switchCamera();
                  setCameraFacingMode(nextMode);
                  setSelectedCameraId('');
                  setCameraSource('browser-camera');
                  refreshCameraDevices();
                }
              }}
              disabled={!isPhysicalSource && numberOfCameras <= 1}
            >
              <RefreshCw size={16} />
              {isPhysicalSource ? 'Refresh' : 'Switch'}
            </button>
          </div>

          <div className="scanner-guide-controls">
            <label className="form-label" htmlFor="paper-guide-size">Paper Guide</label>
            <select
              id="paper-guide-size"
              className="form-select"
              value={paperGuideId}
              onChange={e => setPaperGuideId(e.target.value)}
            >
              {paperGuides.map((guide) => (
                <option key={guide.id} value={guide.id}>{guide.label}</option>
              ))}
            </select>
          </div>

          <div className="scanner-preview-shell">
            {isPhysicalSource ? (
              device?.connected ? (
                <img
                  key={`physical-preview-${streamReloadKey}`}
                  ref={previewImgRef}
                  className="scanner-live-stream"
                  decoding="sync"
                  src={directStreamUrl || undefined}
                  alt="Physical scanner live preview"
                  onLoad={() => {
                    if (directStreamUrl) {
                      previewReadyRef.current = true;
                      setPreviewReady(true);
                      setPreviewMode('direct');
                      setStreamHasError(false);
                      setPreviewErrorMessage('');
                    }
                  }}
                  onError={() => {
                    if (directStreamUrl && hasLanBridge) {
                      setPreviewErrorMessage('MJPEG unavailable on Pi. Using LAN snapshot preview...');
                      lanSnapshotStarterRef.current?.();
                    }
                  }}
                />
              ) : (
                <div className="scanner-preview-empty">
                  <CameraIcon size={34} />
                  <span>Physical scanner is offline</span>
                </div>
              )
            ) : (
              <Camera
                key={selectedCameraId || cameraFacingMode}
                ref={camera}
                numberOfCamerasCallback={setNumberOfCameras}
                videoReadyCallback={refreshCameraDevices}
                videoSourceDeviceId={selectedCameraId || undefined}
                facingMode={cameraFacingMode}
                aspectRatio="cover"
              />
            )}

            <div className="scanner-paper-overlay" style={{ '--paper-ratio': selectedPaperGuide.ratio }}>
              <div className="scanner-paper-frame">
                <span className="scanner-paper-label">{selectedPaperGuide.label}</span>
                <span className="scanner-corner corner-tl"></span>
                <span className="scanner-corner corner-tr"></span>
                <span className="scanner-corner corner-bl"></span>
                <span className="scanner-corner corner-br"></span>
                <span className="scanner-center-line horizontal"></span>
                <span className="scanner-center-line vertical"></span>
              </div>
              <div className="scanner-scan-line"></div>
            </div>

            {isPhysicalSource && previewReady && !streamStale && (
              <div className="scanner-preview-warning" style={{ background: 'var(--success-bg, rgba(16, 185, 129, 0.12))', color: 'var(--success, #10b981)' }}>
                <Wifi size={16} />
                <span>{previewLabel}</span>
              </div>
            )}

            {isPhysicalSource && previewReady && streamStale && (
              <div className="scanner-preview-empty" style={{ position: 'absolute', inset: 0, zIndex: 3, background: 'rgba(0,0,0,0.55)' }}>
                <Loader2 size={30} className="animate-spin" />
                <span>Reconnecting camera stream...</span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: '0.75rem', padding: '0.4rem 1rem' }}
                  onClick={() => {
                    setStreamStale(false);
                    setPreviewErrorMessage('');
                    setStreamReloadKey(value => value + 1);
                  }}
                >
                  <RefreshCw size={14} /> Reload preview
                </button>
              </div>
            )}

            {isPhysicalSource && device?.connected && !previewReady && !streamHasError && (
              <div className="scanner-preview-empty" style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
                <CameraIcon size={34} />
                <span>{previewErrorMessage || 'Connecting camera stream...'}</span>
              </div>
            )}

            {isPhysicalSource && streamHasError && !previewReady && (
              <div className="scanner-preview-warning">
                <AlertCircle size={16} />
                <span>{previewErrorMessage || 'WebSocket camera stream is not ready yet.'}</span>
              </div>
            )}

            {isExtracting && (
              <div style={{
                position: 'absolute', inset: 0,
                backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', color: '#fff', zIndex: 10,
              }}>
                <div style={{ width: '200px', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', marginBottom: '1rem', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'var(--accent)', width: `${progress}%`, transition: 'width 0.3s' }}></div>
                </div>
                <p style={{ fontWeight: '600' }}>Extracting Text... {progress}%</p>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
            <button
              onClick={handleCapture}
              disabled={isExtracting || isDeviceScanning || (isPhysicalSource && !device?.connected)}
              className="btn btn-primary"
              style={{ padding: '0.75rem 2rem' }}>
              {isExtracting || isDeviceScanning ? <Loader2 className="animate-spin" /> : <Zap size={18} />}
              {isExtracting ? 'Processing...' : isPhysicalSource ? 'Capture with Physical Scanner' : 'Capture Document'}
            </button>
            {(isDeviceScanning || /pending command/i.test(deviceScanStatus || '')) && (
              <button
                onClick={handleCancelPhysicalScan}
                disabled={isExtracting}
                className="btn btn-secondary"
                style={{ padding: '0.75rem 2rem' }}
              >
                <XCircle size={18} />
                Cancel Scan
              </button>
            )}
            {!isPhysicalSource && (
              <button
                onClick={handlePhysicalScan}
                disabled={isExtracting || isDeviceScanning || !device?.connected}
                className="btn btn-secondary"
                style={{ padding: '0.75rem 2rem' }}
              >
                {isDeviceScanning ? <Loader2 className="animate-spin" /> : <Scan size={18} />}
                {isDeviceScanning ? 'Waiting...' : 'Use Physical Scanner'}
              </button>
            )}
          </div>
          {deviceScanStatus && (
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--warning-bg)', borderRadius: 'var(--radius-md)', color: 'var(--warning)', fontSize: '0.85rem' }}>
              <AlertCircle size={14} style={{ display: 'inline', marginRight: '0.25rem' }} />
              {deviceScanStatus}
            </div>
          )}
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
                  <Image size={18} style={{ color: 'var(--primary-light)' }} />
                  Scanned Document
                </h3>
              </div>
              {capturedImage ? (
                isCapturedPdf ? (
                  <PdfFitPreview src={resolveUploadUrl(capturedImage)} />
                ) : (
                  <img
                    src={resolveUploadUrl(capturedImage)}
                    alt="Scanned document"
                    className="scanner-image-preview"
                  />
                )
              ) : (
                <div className="scanner-preview-empty" style={{ minHeight: '220px' }}>
                  <Image size={28} />
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

              <form onSubmit={handleProceedToReview}>
                <div className="form-group">
                  <label className="form-label">Document Subject / Description *</label>
                  <input
                    className="form-input" type="text"
                    value={formData.subject}
                    onChange={e => handleFormChange('subject', e.target.value)}
                    placeholder="e.g. Memorandum on Water Resource Management"
                    required autoFocus
                  />
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Document Type</label>
                    <select className="form-select" value={formData.documentTypeId}
                      onChange={e => handleFormChange('documentTypeId', e.target.value)}>
                      {documentTypes.map(dt => (
                        <option key={dt.id} value={dt.id}>{dt.category}</option>
                      ))}
                    </select>
                    {isOtherDocumentType(formData.documentTypeId) && (
                      <input
                        className="form-input"
                        type="text"
                        value={formData.documentTypeOther}
                        onChange={e => handleFormChange('documentTypeOther', e.target.value)}
                        placeholder="Specify document type"
                        required
                        style={{ marginTop: '0.5rem' }}
                      />
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Direction</label>
                    <select className="form-select" value={formData.documentDirection}
                      onChange={e => handleFormChange('documentDirection', e.target.value)}
                      disabled={!canChooseDirection}>
                      <option>Incoming</option>
                      {canChooseDirection && <option>Outgoing</option>}
                    </select>
                  </div>
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">
                      <Flag size={14} style={{ display: 'inline', marginRight: '0.25rem' }} />
                      Priority Level
                    </label>
                    <div className="priority-select-wrap" style={{ '--priority-color': selectedPriority.color, '--priority-bg': selectedPriority.bg }}>
                      <span className="priority-color-preview"></span>
                      <select className="form-select priority-select" value={formData.priorityLevel}
                        onChange={e => handleFormChange('priorityLevel', e.target.value)}>
                        {priorityLevels.map(p => (
                          <option key={p.id} value={p.id} style={{ color: p.color, backgroundColor: p.bg }}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Date Received</label>
                    <input className="form-input" type="date" value={formData.dateReceived}
                      disabled required />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Pending Workflow Status</label>
                  <select
                    className="form-select"
                    value={formData.status}
                    onChange={e => handleFormChange('status', e.target.value)}
                    disabled={!canSetInitialStatus}
                  >
                    <option>Received</option>
                    <option>For Signing</option>
                    <option>For Filing</option>
                  </select>
                  <p className="field-hint">Set the initial pending status before Mayor review.</p>
                </div>

                {/* Sender Information */}
                <div style={{
                  padding: '0.75rem', background: 'var(--bg-elevated)',
                  borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)',
                  marginBottom: '0.75rem',
                }}>
                  <p style={{ fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                    <User size={12} style={{ display: 'inline', marginRight: '0.25rem' }} />
                    Sender Information
                  </p>
                  <div className="form-group">
                    <label className="form-label">Sender Name *</label>
                    <input className="form-input" type="text" value={formData.senderName}
                      onChange={e => handleFormChange('senderName', e.target.value)}
                      placeholder="Full name of the sender" required />
                  </div>
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">
                        <Phone size={12} style={{ display: 'inline', marginRight: '0.25rem' }} />
                        Contact Number
                      </label>
                      <input className="form-input" type="tel" value={formData.senderContact}
                        onChange={e => handleFormChange('senderContact', e.target.value)}
                        placeholder="09XX-XXX-XXXX" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">
                        <Mail size={12} style={{ display: 'inline', marginRight: '0.25rem' }} />
                        Email
                      </label>
                      <input className="form-input" type="email" value={formData.senderEmail}
                        onChange={e => handleFormChange('senderEmail', e.target.value)}
                        placeholder="email@example.com" />
                    </div>
                  </div>
                  <div className="sender-notification-options">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={formData.notifySender}
                        onChange={e => setFormData({ ...formData, notifySender: e.target.checked })}
                      />
                      Send tracking number and status updates to sender
                    </label>
                    <div className="sender-channel-options">
                      <label className="checkbox-chip">
                        <input
                          type="checkbox"
                          checked={(formData.senderNotificationChannels || []).includes('sms')}
                          onChange={() => toggleSenderChannel('sms')}
                        />
                        SMS
                      </label>
                      <label className="checkbox-chip">
                        <input
                          type="checkbox"
                          checked={(formData.senderNotificationChannels || []).includes('email')}
                          onChange={() => toggleSenderChannel('email')}
                        />
                        Email
                      </label>
                    </div>
                  </div>
                </div>

                {/* Routing */}
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">
                      <Building2 size={14} style={{ display: 'inline', marginRight: '0.25rem' }} />
                      From Office
                    </label>
                    <select
                      className="form-select"
                      value={formData.fromOfficeId}
                      onChange={e => {
                        handleFormChange('fromOfficeId', e.target.value);
                        if (formData.toOfficeId === e.target.value) {
                          handleFormChange('toOfficeId', getNextOfficeId(e.target.value));
                        }
                      }}
                    >
                      <option value={OTHER_OFFICE_VALUE}>External / Other Office</option>
                      {(canChooseSourceOffice ? offices : offices.filter(o => o.id === defaultSourceOfficeId))
                        .map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    {formData.fromOfficeId === OTHER_OFFICE_VALUE && (
                      <input
                        className="form-input"
                        type="text"
                        value={formData.originOfficeOther}
                        onChange={e => handleFormChange('originOfficeOther', e.target.value)}
                        placeholder="Name of school, agency, municipality, or external office"
                        required
                        style={{ marginTop: '0.5rem' }}
                      />
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">
                      <Building2 size={14} style={{ display: 'inline', marginRight: '0.25rem' }} />
                      To Office
                    </label>
                    <select className="form-select" value={formData.toOfficeId}
                      onChange={e => handleFormChange('toOfficeId', e.target.value)}>
                      {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
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
                  <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>
                    <ArrowLeft size={16} /> Re-scan
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={
                      !formData.subject.trim() ||
                      !formData.senderName.trim() ||
                      (isOtherDocumentType(formData.documentTypeId) && !formData.documentTypeOther.trim()) ||
                      (formData.fromOfficeId === OTHER_OFFICE_VALUE && !formData.originOfficeOther.trim())
                    }
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
            Please verify all information below before submitting.
          </p>

          <div className="grid-2" style={{ gap: '1.25rem', marginBottom: '1.5rem' }}>
            {/* Scanned Preview */}
            <div>
              {capturedImage ? (
                isCapturedPdf ? (
                  <PdfFitPreview src={resolveUploadUrl(capturedImage)} alt="Scanned document review" />
                ) : (
                  <img src={resolveUploadUrl(capturedImage)} alt="Scanned" className="scanner-image-preview" />
                )
              ) : null}
            </div>

            {/* Details Summary */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {[
                { label: 'Subject', value: formData.subject },
                { label: 'Type', value: getDocTypeName(formData.documentTypeId) },
                { label: 'Direction', value: formData.documentDirection },
                { label: 'Pending Status', value: formData.status },
                { label: 'Priority', value: getPriorityInfo(formData.priorityLevel).label, color: getPriorityInfo(formData.priorityLevel).color },
                { label: 'Date Received', value: formData.dateReceived },
                { label: 'From Office', value: getOfficeName(formData.fromOfficeId) },
                { label: 'Sender', value: formData.senderName },
                { label: 'Contact', value: formData.senderContact || '—' },
                { label: 'Email', value: formData.senderEmail || '—' },
                { label: 'Sender Updates', value: formData.notifySender ? (formData.senderNotificationChannels || []).join(', ').toUpperCase() || 'Enabled' : 'Disabled' },
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
              Route Preview
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', justifyContent: 'center' }}>
              <span style={{
                padding: '0.375rem 0.75rem', borderRadius: 'var(--radius-sm)',
                background: 'var(--primary-glow)', color: 'var(--primary-light)',
                fontSize: '0.8rem', fontWeight: 600,
              }}>
                {getOfficeName(formData.fromOfficeId)}
              </span>
              <ArrowRight size={18} style={{ color: 'var(--primary-light)' }} />
              <span style={{
                padding: '0.375rem 0.75rem', borderRadius: 'var(--radius-sm)',
                background: 'var(--success-bg)', color: 'var(--success)',
                fontSize: '0.8rem', fontWeight: 600,
              }}>
                {getOfficeName(formData.toOfficeId)}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-secondary" onClick={() => setStep(2)}>
              <ArrowLeft size={16} /> Edit Details
            </button>
            <button className="btn btn-primary" onClick={handleConfirmSubmit} style={{ padding: '0.75rem 2rem' }}>
              <Send size={16} /> Confirm & Submit
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
            Document Submitted for Review
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            The scan was saved in the database and is waiting for intake approval before routing.
          </p>

          <div style={{
            padding: '1rem', background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-md)', marginBottom: '1.5rem',
            textAlign: 'left',
          }}>
            {[
              { label: 'Subject', value: formData.subject },
              { label: 'Pending Status', value: formData.status },
              { label: 'Priority', value: getPriorityInfo(formData.priorityLevel).label },
              { label: 'Sender', value: formData.senderName },
              { label: 'Planned Route', value: `${getOfficeName(formData.fromOfficeId)} -> ${getOfficeName(formData.toOfficeId)}` },
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
