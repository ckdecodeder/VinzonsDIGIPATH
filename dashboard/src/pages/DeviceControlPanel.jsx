import React, { useEffect, useRef, useState } from 'react';
import PageShell from '../components/PageShell';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock,
  Building2,
  Cpu,
  HardDrive,
  Hash,
  Info,
  KeyRound,
  MapPin,
  RefreshCcw,
  ScanLine,
  Server,
  ShieldCheck,
  Signal,
  User,
  Wifi,
  WifiOff,
  XCircle,
  Zap,
} from 'lucide-react';
import { bridgeService, commandService, deviceService } from '../api/documentService';
import { useLiveDevice } from '../hooks/useLiveDevice';
import { getWsUrl } from '../ws/realtimeClient';
import { users as defaultUsers } from '../data/mockData';

import { getApiBase } from '../api/apiBase';
const DEFAULT_BRIDGE_PORT = import.meta.env.VITE_SCANNER_BRIDGE_PORT || '8080';

const normalizeBridgeUrl = (value) => {
  let trimmed = value.trim().replace(/^(https?:\/\/):+/i, '$1');
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = trimmed.replace(/^:+/, '');
  }

  try {
    const parsed = new URL(trimmed.match(/^https?:\/\//i) ? trimmed : `http://${trimmed}`);
    const numericPath = parsed.pathname.match(/^\/(\d+)\/?$/);
    if (!parsed.port) {
      parsed.port = numericPath ? (numericPath[1] === '5000' ? DEFAULT_BRIDGE_PORT : numericPath[1]) : DEFAULT_BRIDGE_PORT;
    }
    if (numericPath || parsed.pathname === '/') {
      parsed.pathname = '';
    }
    parsed.search = '';
    parsed.hash = '';
    return parsed.origin;
  } catch {
    return trimmed.replace(/\/$/, '');
  }
};

const resolveDetectedIp = (scanner) => {
  const candidates = [scanner.ip, scanner.payload?.ip];
  for (const value of candidates) {
    const text = String(value || '').trim();
    if (text && text !== 'Not reported') return text;
  }
  return '';
};

const bridgeUrlFromIp = (ip, port = DEFAULT_BRIDGE_PORT) => (
  ip ? normalizeBridgeUrl(`http://${ip}:${port}`) : ''
);

const getBridgeMode = (scanner) => {
  const version = String(scanner?.payload?.bridgeVersion || '').toLowerCase();
  if (version.startsWith('ws-only')) return 'websocket';
  return 'http-bridge';
};

const computeConnectionStatus = (scanner, now = Date.now()) => {
  const timeoutMs = scanner.heartbeatTimeoutMs || 12000;
  const lastSignal = scanner.lastSignalAt || scanner.lastActive;
  const lastMs = lastSignal ? new Date(lastSignal).getTime() : NaN;
  const secondsSinceSignal = Number.isNaN(lastMs)
    ? null
    : Math.max(0, Math.floor((now - lastMs) / 1000));
  const heartbeatFresh = !Number.isNaN(lastMs)
    && (now - lastMs) <= timeoutMs
    && scanner.lastEventType !== 'device_disconnected';
  const hasSignal = Boolean(lastSignal);
  const wsLive = Boolean(scanner.streamWsConnected);
  const connected = wsLive || (hasSignal && heartbeatFresh);

  return {
    connected,
    heartbeatFresh,
    wsLive,
    secondsSinceSignal,
    cameraReady: Boolean(scanner.payload?.cameraReady),
    bridgeMode: getBridgeMode(scanner),
    bridgeVersion: scanner.payload?.bridgeVersion || scanner.firmware || 'unknown',
    waitingForDevice: scanner.connectionState === 'waiting_for_device' || !hasSignal,
  };
};

const formatSignalAge = (seconds) => {
  if (seconds === null) return 'No signal yet';
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
};

const DeviceControlPanel = ({ device: deviceProp, onRefresh, logs, users = defaultUsers, offices = [], deviceEvents = [] }) => {
  const { device: liveDevice } = useLiveDevice(deviceProp);
  const [clockMs, setClockMs] = useState(Date.now());
  const [showLegacyBridgeControls, setShowLegacyBridgeControls] = useState(false);

  useEffect(() => {
    const tickId = setInterval(() => setClockMs(Date.now()), 1000);
    return () => clearInterval(tickId);
  }, []);

  const scanner = liveDevice || {
    id: 'DEV-001',
    name: 'No physical scanner connected',
    model: 'Not reported',
    type: 'Scanner',
    status: 'Offline',
    connected: false,
    configured: false,
    scanCount: 0,
    heartbeatTimeoutMs: 30000,
  };

  const connection = computeConnectionStatus(scanner, clockMs);
  const isConnected = connection.connected;
  const isWsOnlyBridge = connection.bridgeMode === 'websocket';
  const detectedIp = resolveDetectedIp(scanner);
  const getReportedBridgeUrl = () => {
    const deviceIp = detectedIp;
    const ipBridge = bridgeUrlFromIp(deviceIp);
    if (ipBridge) return ipBridge;

    const reportedBridge = scanner.bridgeUrl || scanner.payload?.bridgeUrl;
    if (reportedBridge) {
      return normalizeBridgeUrl(reportedBridge);
    }

    const reportedStream = scanner.streamUrl || scanner.payload?.streamUrl;
    if (reportedStream && /^https?:\/\//i.test(String(reportedStream))) {
      try {
        const streamOrigin = new URL(reportedStream).origin;
        if (deviceIp) {
          try {
            if (new URL(streamOrigin).hostname === deviceIp) return normalizeBridgeUrl(streamOrigin);
          } catch {
            // fall through
          }
          return ipBridge;
        }
        return normalizeBridgeUrl(streamOrigin);
      } catch {
        const match = String(reportedStream).match(/^(https?:\/\/[^/]+)/i);
        if (match) return normalizeBridgeUrl(match[1]);
      }
    }

    return '';
  };
  const [manualBridgeUrl, setManualBridgeUrl] = useState('');
  const [bridgeUrlDirty, setBridgeUrlDirty] = useState(false);
  const lastAutoBridgeUrlRef = useRef('');
  const [isBridgeConnecting, setIsBridgeConnecting] = useState(false);
  const [bridgeActionMessage, setBridgeActionMessage] = useState('');
  const [bridgeStatus, setBridgeStatus] = useState(null);
  const [deviceForm, setDeviceForm] = useState({
    name: '',
    location: '',
    assignedTo: '',
  });
  const [isSavingDevice, setIsSavingDevice] = useState(false);
  const [deviceSaveMessage, setDeviceSaveMessage] = useState('');
  const [isCancellingCommand, setIsCancellingCommand] = useState(false);
  const autoBridgeUrl = getReportedBridgeUrl();

  useEffect(() => {
    if (!autoBridgeUrl) return;

    const normalizedAuto = normalizeBridgeUrl(autoBridgeUrl);
    const normalizedManual = normalizeBridgeUrl(manualBridgeUrl);
    const previousAuto = lastAutoBridgeUrlRef.current
      ? normalizeBridgeUrl(lastAutoBridgeUrlRef.current)
      : '';

    if (!bridgeUrlDirty) {
      setManualBridgeUrl(normalizedAuto);
    } else if (previousAuto && normalizedManual === previousAuto && normalizedAuto !== normalizedManual) {
      // WiFi/IP changed but the field still shows the previous auto-detected URL.
      setManualBridgeUrl(normalizedAuto);
      setBridgeUrlDirty(false);
    }

    lastAutoBridgeUrlRef.current = normalizedAuto;
  }, [autoBridgeUrl, bridgeUrlDirty, manualBridgeUrl]);

  useEffect(() => {
    setDeviceForm({
      name: scanner.name || '',
      location: scanner.location && scanner.location !== 'Not reported' ? scanner.location : '',
      assignedTo: scanner.assignedTo && scanner.assignedTo !== 'Not reported' ? scanner.assignedTo : '',
    });
  }, [scanner.id, scanner.name, scanner.location, scanner.assignedTo]);

  const normalizedManualBridgeUrl = normalizeBridgeUrl(manualBridgeUrl);
  const effectiveBridgeUrl = normalizedManualBridgeUrl || autoBridgeUrl;
  const bridgeUrlSource = bridgeUrlDirty && normalizedManualBridgeUrl
    ? 'manual'
    : (autoBridgeUrl ? 'auto' : (normalizedManualBridgeUrl ? 'manual' : 'waiting'));

  const getBridgePayload = () => ({
    deviceId: scanner.id || 'DEV-001',
    ...(effectiveBridgeUrl ? { bridgeUrl: effectiveBridgeUrl } : {}),
  });
  const hardwareEvents = [...deviceEvents]
    .filter(event => event.recordedBy === 'hardware')
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const latestTelemetry = hardwareEvents.find(event => event.deviceId === scanner.id && event.payload)?.payload || {};
  const latestSignal = hardwareEvents.find(event => event.deviceId === scanner.id);
  const heartbeatSeconds = Math.round((scanner.heartbeatTimeoutMs || 30000) / 1000);

  const getMetric = (key) => Number(latestTelemetry[key] ?? 0);
  const hasMetric = (key) => latestTelemetry[key] !== undefined && latestTelemetry[key] !== null;
  const displayValue = (value, fallback = 'Not reported') => value || fallback;

  const getUserFullName = (userId) => {
    if (!userId || userId === 'hardware') return 'Hardware device';
    const user = users.find(u => u.id === userId);
    return user ? `${user.fname} ${user.mname || ''} ${user.lname}`.replace(/\s+/g, ' ').trim() : 'Unknown';
  };

  const formatDateTime = (value) => {
    if (!value) return 'No signal yet';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const statusColor = isConnected ? 'var(--success)' : 'var(--danger)';
  const statusBg = isConnected ? 'var(--success-bg)' : 'var(--danger-bg)';

  const ProgressBar = ({ value, max = 100, color }) => (
    <div style={{ width: '100%', height: '6px', background: 'var(--bg-elevated)', borderRadius: '3px', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min((value / max) * 100, 100)}%`, background: color, borderRadius: '3px', transition: 'width 1s ease' }} />
    </div>
  );

  const deviceWsUrl = getWsUrl().replace(/\/ws$/, '/ws/device');

  const endpointRows = [
    { label: 'WebSocket Auth', method: 'WS', url: `${deviceWsUrl} — { "type": "auth", "deviceId": "DEV-001", "apiKey": "..." }` },
    { label: 'Connect (WebSocket)', method: 'WS', url: `${deviceWsUrl} — { "type": "device_connected", "payload": { ... } }` },
    { label: 'Heartbeat (WebSocket)', method: 'WS', url: `${deviceWsUrl} — { "type": "heartbeat", "payload": { ... } }` },
    { label: 'HTTP fallback', method: 'POST', url: `${getApiBase()}/devices/heartbeat (legacy / testing only)` },
  ];


  const handleSaveDeviceSettings = async () => {
    setIsSavingDevice(true);
    setDeviceSaveMessage('');
    try {
      await deviceService.update({
        id: scanner.id || 'DEV-001',
        name: deviceForm.name.trim() || 'Physical Document Scanner',
        location: deviceForm.location.trim(),
        assignedTo: deviceForm.assignedTo,
        bridgeUrl: effectiveBridgeUrl || undefined,
      });
      setDeviceSaveMessage('Device settings saved.');
      await onRefresh?.();
    } catch (err) {
      setDeviceSaveMessage(err.message || 'Unable to save device settings.');
    } finally {
      setIsSavingDevice(false);
    }
  };

  const handleBridgeConnect = async () => {
    const payload = getBridgePayload();
    if (!autoBridgeUrl && !effectiveBridgeUrl) {
      setBridgeActionMessage('Waiting for the Pi to send a heartbeat so the bridge URL can be detected automatically.');
      return;
    }

    setIsBridgeConnecting(true);
    setBridgeActionMessage('Sending connection handshake through the backend...');
    try {
      const result = await bridgeService.connect(payload);
      setBridgeStatus(result.status || result.bridge || null);
      const connectedNow = Boolean(result.device?.connected || scanner.connected);
      setBridgeActionMessage(result.ok && result.bridgeReachable === false
        ? result.message || 'Backend heartbeat is live. The scanner is connected; the bridge control endpoint did not answer the manual handshake.'
        : result.ok
          ? 'Handshake sent through the backend. Refreshing device status...'
          : connectedNow
            ? 'Backend heartbeat is live. The scanner is connected; the bridge control endpoint did not answer the manual handshake.'
            : result.message || 'Backend can see scanner records, but the bridge control endpoint did not answer.');
      await onRefresh?.();
    } catch (err) {
      setBridgeActionMessage(scanner.connected
        ? `Backend heartbeat is live. Manual bridge handshake failed: ${err.message || ''}`.trim()
        : `Unable to ask backend to connect to scanner bridge. ${err.message || ''}`.trim());
    } finally {
      setIsBridgeConnecting(false);
    }
  };

  const handleBridgeStatus = async () => {
    const payload = getBridgePayload();
    if (!autoBridgeUrl && !effectiveBridgeUrl) {
      setBridgeActionMessage('Waiting for the Pi to send a heartbeat so the bridge URL can be detected automatically.');
      return;
    }

    setIsBridgeConnecting(true);
    setBridgeActionMessage('Checking scanner bridge status through the backend...');
    try {
      const result = await bridgeService.status(payload);
      const status = result.status || null;
      setBridgeStatus(status);
      if (result.ok) {
        const cameraReady = Boolean(status?.cameraReady ?? status?.camera);
        const backendText = status?.cameraBackends?.length ? ` via ${status.cameraBackends.join(', ')}` : '';
        const errorText = status?.cameraError ? ` ${status.cameraError}` : '';
        setBridgeActionMessage(`Bridge online. Camera ${cameraReady ? 'ready' : 'not ready'}${backendText}${status?.capturing ? ', capture in progress' : ''}.${errorText}`.trim());
      } else if (result.device?.connected || scanner.connected) {
        setBridgeActionMessage(result.message || 'Backend heartbeat is live, but the bridge status/preview endpoint did not answer. Check the Pi service firewall and port 8080.');
      } else {
        setBridgeActionMessage(result.message || 'Backend has scanner data, but bridge status did not answer.');
      }
      await onRefresh?.();
    } catch (err) {
      setBridgeStatus(null);
      setBridgeActionMessage(scanner.connected
        ? `Backend heartbeat is live, but the status check failed: ${err.message || ''}`.trim()
        : `Unable to ask backend to check scanner bridge. ${err.message || ''}`.trim());
    } finally {
      setIsBridgeConnecting(false);
    }
  };

  const handleBridgeDisconnect = async () => {
    const payload = getBridgePayload();
    if (!autoBridgeUrl && !effectiveBridgeUrl) return;

    setIsBridgeConnecting(true);
    setBridgeActionMessage('Sending disconnect signal through the backend...');
    try {
      const result = await bridgeService.disconnect(payload);
      setBridgeStatus(result.bridge || null);
      const offlineNow = result.device?.connected === false;
      setBridgeActionMessage(result.ok || offlineNow
        ? 'Disconnect signal sent through the backend. Refreshing device status...'
        : result.message || 'Disconnect signal could not reach the bridge control endpoint.');
      await onRefresh?.();
    } catch (err) {
      setBridgeActionMessage(`Unable to ask backend to disconnect scanner bridge. ${err.message || ''}`.trim());
    } finally {
      setIsBridgeConnecting(false);
    }
  };

  const handleCancelPendingScan = async () => {
    setIsCancellingCommand(true);
    setBridgeActionMessage('Cancelling pending scanner commands...');
    try {
      const result = await commandService.cancelPending(scanner.id || 'DEV-001');
      setBridgeActionMessage(
        result.cancelled
          ? `Cancelled ${result.cancelled} pending scan command(s).`
          : 'No pending scan commands found.',
      );
      await onRefresh?.();
    } catch (err) {
      setBridgeActionMessage(`Unable to cancel pending scan. ${err.message || ''}`.trim());
    } finally {
      setIsCancellingCommand(false);
    }
  };

  const samplePayload = `{
  "deviceId": "DEV-001",
  "name": "Physical Document Scanner",
  "model": "Scanner prototype",
  "location": "Reception Area",
  "serialNumber": "DEVICE-SERIAL",
  "firmware": "prototype",
  "payload": {
    "cpuUsage": 12,
    "memoryUsage": 24,
    "diskUsage": 18,
    "networkLatency": 8
  }
}`;

  const deviceLogs = logs
    .filter(l => l.action === 'device_event' || l.action === 'device_config_updated' || l.referenceId === scanner.id)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 5);

  return (
    <PageShell
      header={
        <div className="page-header page-header--align-bottom">
          <div className="page-header-left">
            <h1>Device Management</h1>
            <p>Physical scanner connection, heartbeat status, and hardware telemetry</p>
          </div>
          <div className="page-header-actions">
            <button className="btn btn-secondary" onClick={onRefresh}>
              <RefreshCcw size={16} /> Refresh
            </button>
          </div>
        </div>
      }
    >
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="card-header">
          <h3 className="card-title">Scanner Connection</h3>
          <span className={`status-badge ${isConnected ? 'status-online' : 'status-offline'}`} style={{ fontSize: '0.65rem' }}>
            {isConnected ? 'Online' : 'Offline'}
          </span>
        </div>

        <p style={{ margin: '0 0 1rem', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
          {isWsOnlyBridge
            ? 'Status updates automatically from the Pi WebSocket heartbeat. No manual connect is required.'
            : 'Status updates automatically when the Pi sends heartbeats to the backend.'}
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}>
          {[
            {
              label: 'Heartbeat',
              value: isConnected ? 'Fresh' : connection.waitingForDevice ? 'Waiting' : 'Stale',
              tone: isConnected ? 'var(--success)' : connection.waitingForDevice ? 'var(--warning)' : 'var(--danger)',
            },
            {
              label: 'Last signal',
              value: formatSignalAge(connection.secondsSinceSignal),
              tone: 'var(--text-secondary)',
            },
            {
              label: 'WebSocket',
              value: connection.wsLive ? 'Connected' : 'Disconnected',
              tone: connection.wsLive ? 'var(--success)' : 'var(--danger)',
            },
            {
              label: 'Camera',
              value: connection.cameraReady ? 'Ready' : 'Not ready',
              tone: connection.cameraReady ? 'var(--success)' : 'var(--text-muted)',
            },
            {
              label: 'Bridge',
              value: isWsOnlyBridge ? 'WebSocket-only' : 'HTTP bridge',
              tone: 'var(--accent)',
            },
            {
              label: 'Firmware',
              value: connection.bridgeVersion,
              tone: 'var(--text-secondary)',
            },
          ].map((row) => (
            <div
              key={row.label}
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '0.75rem',
                background: 'var(--bg-elevated)',
              }}
            >
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>{row.label}</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: row.tone }}>{row.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="btn btn-secondary"
            onClick={handleCancelPendingScan}
            disabled={isCancellingCommand}
          >
            {isCancellingCommand ? <RefreshCcw size={16} className="animate-spin" /> : <XCircle size={16} />}
            Cancel Pending Scan
          </button>
          {!isWsOnlyBridge && (
            <button
              type="button"
              className="btn btn-link"
              style={{ padding: 0, fontSize: '0.78rem' }}
              onClick={() => setShowLegacyBridgeControls((prev) => !prev)}
            >
              {showLegacyBridgeControls ? 'Hide legacy HTTP bridge controls' : 'Show legacy HTTP bridge controls'}
            </button>
          )}
        </div>

        {bridgeActionMessage && (
          <div style={{
            marginTop: '0.85rem',
            padding: '0.75rem',
            borderRadius: 'var(--radius-md)',
            background: bridgeActionMessage.startsWith('Unable') ? 'var(--danger-bg)' : 'var(--info-bg)',
            color: bridgeActionMessage.startsWith('Unable') ? 'var(--danger)' : 'var(--info)',
            fontSize: '0.8rem',
            fontWeight: 600,
          }}>
            {bridgeActionMessage}
          </div>
        )}

        {!isWsOnlyBridge && showLegacyBridgeControls && (
          <div className="scanner-bridge-controls" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Legacy Scanner Bridge URL</label>
              <input
                className="form-input"
                value={manualBridgeUrl}
                onChange={(e) => {
                  setBridgeUrlDirty(true);
                  setManualBridgeUrl(e.target.value);
                }}
                placeholder="http://raspberry-pi-ip:8080"
              />
              <p className="field-hint">
                {bridgeUrlSource === 'auto'
                  ? `Auto-detected IP (${detectedIp || 'waiting for heartbeat'}). Optional manual control for older HTTP bridges.`
                  : bridgeUrlSource === 'manual'
                    ? 'Using a manual URL for legacy HTTP bridge control.'
                    : 'Wait for the Pi heartbeat to detect the IP, or type the bridge URL manually.'}
              </p>
            </div>
            <button className="btn btn-secondary" onClick={handleBridgeConnect} disabled={isBridgeConnecting}>
              {isBridgeConnecting ? <RefreshCcw size={16} className="animate-spin" /> : <Wifi size={16} />}
              Connect
            </button>
            <button className="btn btn-secondary" onClick={handleBridgeStatus} disabled={isBridgeConnecting}>
              <Signal size={16} />
              Check
            </button>
            <button className="btn btn-secondary" onClick={handleBridgeDisconnect} disabled={isBridgeConnecting}>
              <WifiOff size={16} />
              Disconnect
            </button>
            {bridgeStatus && (
              <div style={{
                width: '100%',
                display: 'flex',
                gap: '0.5rem',
                flexWrap: 'wrap',
                color: 'var(--text-secondary)',
                fontSize: '0.78rem',
              }}>
                <span className="td-mono">bridge: {bridgeStatus.bridgeVersion || bridgeStatus.status || 'online'}</span>
                <span className="td-mono">camera: {(bridgeStatus.cameraReady ?? bridgeStatus.camera) ? 'ready' : 'not ready'}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: '1.25rem', position: 'relative', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: isConnected ? 'var(--gradient-success)' : 'linear-gradient(135deg, #ef4444, #dc2626)',
        }} />

        <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start', flexWrap: 'wrap', paddingTop: '0.5rem' }}>
          <div style={{
            width: '160px',
            height: '160px',
            borderRadius: 'var(--radius-xl)',
            background: statusBg,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            flexShrink: 0,
            border: `2px solid ${statusColor}`,
            position: 'relative',
          }}>
            {isConnected ? <Wifi size={48} style={{ color: statusColor }} /> : <WifiOff size={48} style={{ color: statusColor }} />}
            <span style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              color: statusColor,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
            {isConnected && (
              <div style={{
                position: 'absolute',
                top: '12px',
                right: '12px',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: 'var(--success)',
                boxShadow: '0 0 8px var(--success)',
                animation: 'pulse 2s infinite',
              }} />
            )}
          </div>

          <div style={{ flex: 1, minWidth: '280px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <input
                className="form-input"
                value={deviceForm.name}
                onChange={(e) => setDeviceForm((prev) => ({ ...prev, name: e.target.value }))}
                style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: 0 }}
              />
              <button className="btn btn-secondary" onClick={handleSaveDeviceSettings} disabled={isSavingDevice}>
                {isSavingDevice ? <RefreshCcw size={16} className="animate-spin" /> : null}
                Save
              </button>
            </div>
            {deviceSaveMessage && (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                {deviceSaveMessage}
              </p>
            )}
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              {isConnected
                ? `Scanner is online — last heartbeat ${formatSignalAge(connection.secondsSinceSignal)} (timeout ${heartbeatSeconds}s)`
                : connection.waitingForDevice
                  ? 'Waiting for the Pi to connect and send its first heartbeat'
                  : `Scanner is offline — last signal ${formatDateTime(scanner.lastSignalAt)} (${formatSignalAge(connection.secondsSinceSignal)})`}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem 2rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                <Hash size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>Device ID:</span>
                <span className="td-mono" style={{ fontSize: '0.75rem' }}>{scanner.id}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                <Signal size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>Last Event:</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{displayValue(scanner.lastEventType || latestSignal?.eventType)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                <MapPin size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>Location:</span>
                <input
                  className="form-input"
                  value={deviceForm.location}
                  onChange={(e) => setDeviceForm((prev) => ({ ...prev, location: e.target.value }))}
                  placeholder="Reception Area"
                  style={{ flex: 1, padding: '0.35rem 0.55rem', fontSize: '0.78rem' }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                <Server size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>IP:</span>
                <span className="td-mono" style={{ fontSize: '0.75rem' }}>{displayValue(detectedIp || scanner.ip)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                <Info size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>Firmware:</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{displayValue(scanner.firmware)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                <Zap size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>Resolution:</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{displayValue(scanner.resolution)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                <Building2 size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>Assigned Office:</span>
                <select
                  className="form-select"
                  value={deviceForm.assignedTo}
                  onChange={(e) => setDeviceForm((prev) => ({ ...prev, assignedTo: e.target.value }))}
                  style={{ flex: 1, padding: '0.35rem 0.55rem', fontSize: '0.78rem' }}
                >
                  <option value="">Unassigned</option>
                  {offices.map((office) => (
                    <option key={office.id} value={office.id}>{office.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                <Clock size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>Last Signal:</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{formatDateTime(scanner.lastSignalAt || scanner.lastActive)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                <BarChart3 size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>Hardware Scans:</span>
                <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{scanner.scanCount?.toLocaleString() || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {!isConnected && (
        <div className="card" style={{ marginBottom: '1.25rem', background: 'var(--warning-bg)', borderColor: 'rgba(245, 158, 11, 0.24)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <AlertTriangle size={20} style={{ color: 'var(--warning)' }} />
            <div>
              <h3 className="card-title" style={{ marginBottom: '0.25rem' }}>No Real Device Signal</h3>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.86rem' }}>
                The Pi is not sending a fresh heartbeat right now. Start <span className="td-mono">pi_ws_scanner.py</span> on the Raspberry Pi — status will turn online automatically when heartbeats arrive (every {heartbeatSeconds}s timeout).
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: '1.25rem' }}>
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Connection Process</h3>
            <span className="status-badge status-warning" style={{ fontSize: '0.65rem' }}>
              <KeyRound size={10} /> API Key
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {endpointRows.map(row => (
              <div key={row.label} style={{
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '0.75rem',
                background: 'var(--bg-elevated)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.375rem' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-main)' }}>{row.label}</span>
                  <span className="td-mono" style={{ fontSize: '0.68rem', color: 'var(--accent)' }}>{row.method}</span>
                </div>
                <div className="td-mono" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                  {row.url}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            <span><ShieldCheck size={13} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Header: <span className="td-mono">x-device-key: &lt;DEVICE_API_KEY&gt;</span></span>
            <span><Clock size={13} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Pi sends WebSocket heartbeat every few seconds; backend marks offline after {heartbeatSeconds}s without signal.</span>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Heartbeat Payload</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>JSON</span>
          </div>
          <pre style={{
            margin: 0,
            padding: '1rem',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            fontSize: '0.72rem',
            overflowX: 'auto',
            lineHeight: 1.55,
          }}>{samplePayload}</pre>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Hardware Telemetry</h3>
            <span className={`status-badge ${isConnected ? 'status-online' : 'status-offline'}`} style={{ fontSize: '0.65rem' }}>
              <Activity size={10} /> {isConnected ? 'Live' : 'Waiting'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <Cpu size={14} /> CPU Usage
                </span>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: getMetric('cpuUsage') > 70 ? 'var(--danger)' : 'var(--success)' }}>
                  {hasMetric('cpuUsage') ? `${getMetric('cpuUsage')}%` : 'Not reported'}
                </span>
              </div>
              <ProgressBar value={getMetric('cpuUsage')} color={getMetric('cpuUsage') > 70 ? 'var(--danger)' : 'var(--success)'} />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <BarChart3 size={14} /> Memory Usage
                </span>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: getMetric('memoryUsage') > 80 ? 'var(--danger)' : 'var(--info)' }}>
                  {hasMetric('memoryUsage') ? `${getMetric('memoryUsage')}%` : 'Not reported'}
                </span>
              </div>
              <ProgressBar value={getMetric('memoryUsage')} color={getMetric('memoryUsage') > 80 ? 'var(--danger)' : 'var(--info)'} />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <HardDrive size={14} /> Disk Usage
                </span>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--success)' }}>
                  {hasMetric('diskUsage') ? `${getMetric('diskUsage')}%` : 'Not reported'}
                </span>
              </div>
              <ProgressBar value={getMetric('diskUsage')} color="var(--success)" />
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <Wifi size={14} /> Network Latency
                </span>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--success)' }}>
                  {hasMetric('networkLatency') ? `${getMetric('networkLatency')}ms` : 'Not reported'}
                </span>
              </div>
              <ProgressBar value={getMetric('networkLatency')} max={100} color="var(--accent)" />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Hardware Activity</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {hardwareEvents.length} events
            </span>
          </div>

          {hardwareEvents.length > 0 ? (
            <div className="activity-list">
              {hardwareEvents.slice(0, 8).map(event => (
                <div key={event.id} className="activity-item">
                  <div className={`activity-dot ${event.status === 'Offline' ? 'red' : event.eventType === 'error' ? 'amber' : 'green'}`} />
                  <div style={{ flex: 1 }}>
                    <p className="activity-text">
                      <strong>{event.eventType.replace(/_/g, ' ')}</strong> from {event.deviceId}
                    </p>
                    <p className="activity-time">
                      <Clock size={10} style={{ display: 'inline', marginRight: '0.25rem' }} />
                      {formatDateTime(event.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <ScanLine size={28} style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }} />
              <h3>No hardware events yet</h3>
              <p>Events will appear after the physical scanner connects</p>
            </div>
          )}
        </div>
      </div>

      {deviceLogs.length > 0 && (
        <div className="card" style={{ marginTop: '1.25rem' }}>
          <div className="card-header">
            <h3 className="card-title">System Log Entries</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{deviceLogs.length} entries</span>
          </div>
          <div className="activity-list">
            {deviceLogs.map(log => (
              <div key={log.id} className="activity-item">
                <div className="activity-dot amber" />
                <div style={{ flex: 1 }}>
                  <p className="activity-text">
                    <strong>{getUserFullName(log.userId)}</strong> - {log.details}
                  </p>
                  <p className="activity-time">
                    <Clock size={10} style={{ display: 'inline', marginRight: '0.25rem' }} />
                    {formatDateTime(log.timestamp)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
};

export default DeviceControlPanel;
