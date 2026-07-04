import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock,
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
  Zap,
} from 'lucide-react';
import { bridgeService } from '../api/documentService';
import { users as defaultUsers } from '../data/mockData';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
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

const DeviceControlPanel = ({ device, onRefresh, logs, users = defaultUsers, deviceEvents = [] }) => {
  const scanner = device || {
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

  const isConnected = Boolean(scanner.connected);
  const getReportedBridgeUrl = () => {
    const reportedStream = scanner.streamUrl || scanner.payload?.streamUrl;
    if (reportedStream) {
      try {
        return new URL(reportedStream).origin;
      } catch {
        const match = String(reportedStream).match(/^(https?:\/\/[^/]+)/i);
        if (match) return normalizeBridgeUrl(match[1]);
      }
    }
    if (scanner.ip && scanner.ip !== 'Not reported') return normalizeBridgeUrl(`http://${scanner.ip}:${DEFAULT_BRIDGE_PORT}`);
    return '';
  };
  const getDefaultBridgeUrl = () => {
    const reported = getReportedBridgeUrl();
    if (reported) return reported;
    return import.meta.env.VITE_SCANNER_BRIDGE_URL || `http://127.0.0.1:${DEFAULT_BRIDGE_PORT}`;
  };
  const [bridgeUrl, setBridgeUrl] = useState(() => normalizeBridgeUrl(localStorage.getItem('dp_scannerBridgeUrl') || '') || getDefaultBridgeUrl());
  const [isBridgeConnecting, setIsBridgeConnecting] = useState(false);
  const [bridgeActionMessage, setBridgeActionMessage] = useState('');
  const [bridgeStatus, setBridgeStatus] = useState(null);
  const reportedBridgeUrl = getReportedBridgeUrl();

  useEffect(() => {
    const savedUrl = normalizeBridgeUrl(localStorage.getItem('dp_scannerBridgeUrl') || '');
    const savedLooksLocal = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:|\/|$)/i.test(savedUrl);
    const nextUrl = reportedBridgeUrl && (isConnected || !savedUrl || savedLooksLocal)
      ? reportedBridgeUrl
      : savedUrl || getDefaultBridgeUrl();
    setBridgeUrl(prev => (prev === nextUrl ? prev : nextUrl));
  }, [scanner.ip, scanner.streamUrl, scanner.payload?.streamUrl, isConnected]);

  useEffect(() => {
    const normalized = normalizeBridgeUrl(bridgeUrl);
    if (normalized) {
      localStorage.setItem('dp_scannerBridgeUrl', normalized);
    }
  }, [bridgeUrl]);
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

  const endpointRows = [
    { label: 'Connect', method: 'POST', url: `${API_BASE_URL}/devices/connect` },
    { label: 'Heartbeat', method: 'POST', url: `${API_BASE_URL}/devices/heartbeat` },
    { label: 'Disconnect', method: 'POST', url: `${API_BASE_URL}/devices/disconnect` },
    { label: 'Hardware Event', method: 'POST', url: `${API_BASE_URL}/devices/events` },
  ];

  const getBridgePayload = () => {
    const target = normalizeBridgeUrl(bridgeUrl);
    if (target && target !== bridgeUrl) {
      setBridgeUrl(target);
    }
    return {
      deviceId: scanner.id || 'DEV-001',
      bridgeUrl: target,
    };
  };

  const handleBridgeConnect = async () => {
    const payload = getBridgePayload();
    if (!payload.bridgeUrl) {
      setBridgeActionMessage('Enter the Raspberry Pi bridge URL first.');
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
    if (!payload.bridgeUrl) {
      setBridgeActionMessage('Enter the Raspberry Pi bridge URL first.');
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
    if (!payload.bridgeUrl) return;

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
    <div>
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

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="card-header">
          <h3 className="card-title">Auto-Connect Bridge</h3>
          <span className={`status-badge ${isConnected ? 'status-online' : 'status-warning'}`} style={{ fontSize: '0.65rem' }}>
            {isConnected ? 'Live' : 'Ready'}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto auto', gap: '0.75rem', alignItems: 'end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Scanner Bridge URL</label>
            <input
              className="form-input"
              value={bridgeUrl}
              onChange={e => setBridgeUrl(e.target.value)}
              placeholder="http://raspberry-pi-ip:8080"
            />
            <p className="field-hint">
              The bridge now auto-connects on startup. Use this button only to trigger the handshake from the dashboard.
            </p>
          </div>
          <button className="btn btn-primary" onClick={handleBridgeConnect} disabled={isBridgeConnecting}>
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
        {bridgeStatus && (
          <div style={{
            marginTop: '0.75rem',
            display: 'flex',
            gap: '0.5rem',
            flexWrap: 'wrap',
            color: 'var(--text-secondary)',
            fontSize: '0.78rem',
          }}>
            <span className="td-mono">bridge: {bridgeStatus.bridgeVersion || bridgeStatus.status || 'online'}</span>
            <span className="td-mono">camera: {(bridgeStatus.cameraReady ?? bridgeStatus.camera) ? 'ready' : 'not ready'}</span>
            <span className="td-mono">configured: {bridgeStatus.cameraConfigured ? 'yes' : 'no'}</span>
            {bridgeStatus.cameraBackends?.length ? <span className="td-mono">backends: {bridgeStatus.cameraBackends.join(', ')}</span> : null}
            <span className="td-mono">capturing: {bridgeStatus.capturing ? 'yes' : 'no'}</span>
            {bridgeStatus.cameraError ? <span className="td-mono">error: {bridgeStatus.cameraError}</span> : null}
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
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem', color: 'var(--text-main)' }}>
              {scanner.name}
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              {isConnected
                ? `Last heartbeat received within ${heartbeatSeconds} seconds`
                : 'Waiting for the physical scanner to connect to the backend'}
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
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{displayValue(scanner.location)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                <Server size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>IP:</span>
                <span className="td-mono" style={{ fontSize: '0.75rem' }}>{displayValue(scanner.ip)}</span>
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
                <User size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>Assigned to:</span>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{getUserFullName(scanner.assignedTo)}</span>
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
                The backend has not received a fresh hardware heartbeat. The scanner will stay disconnected until the physical device calls the connection endpoint.
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
            <span><Clock size={13} style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} />Heartbeat must repeat before the {heartbeatSeconds}s timeout.</span>
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
    </div>
  );
};

export default DeviceControlPanel;
