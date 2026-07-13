import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Eye, EyeOff, FileText, Flag, Loader2, LogIn, MapPin, RefreshCw, Search, X } from 'lucide-react';
import { authService, trackingService } from '../api/documentService';
import ModalOverlay from '../components/ModalOverlay';
import ThemeToggle from '../components/ThemeToggle';

const LoginPage = ({ onLogin, systemMessage = '' }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tracking') || '';
  });
  const [trackingResult, setTrackingResult] = useState(null);
  const [trackingError, setTrackingError] = useState('');
  const [isTracking, setIsTracking] = useState(false);
  const [lastTrackingCheck, setLastTrackingCheck] = useState(null);
  const [isTrackingModalOpen, setIsTrackingModalOpen] = useState(false);

  const handleTrackingLookup = async (value = trackingNumber, { silent = false } = {}) => {
    const number = value.trim();
    if (!number) return;

    if (!silent) {
      setTrackingError('');
      setTrackingResult(null);
      setIsTracking(true);
    }

    try {
      const result = await trackingService.track(number);
      setTrackingResult(result);
      setLastTrackingCheck(new Date());
      setTrackingError('');
      if (!silent) setIsTrackingModalOpen(true);
    } catch (err) {
      if (!silent) {
        setTrackingError(err.message || 'Tracking number not found');
        setIsTrackingModalOpen(true);
      }
    } finally {
      if (!silent) {
        setIsTracking(false);
      }
    }
  };

  useEffect(() => {
    if (trackingNumber) {
      handleTrackingLookup(trackingNumber);
    }
  }, []);

  useEffect(() => {
    if (!trackingResult || !trackingNumber.trim()) return undefined;

    const interval = setInterval(() => {
      handleTrackingLookup(trackingNumber, { silent: true });
    }, 15000);

    return () => clearInterval(interval);
  }, [trackingResult?.trackingNumber, trackingNumber]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const user = await authService.login(username, password);
      await onLogin(user);
    } catch (err) {
      setError(err.message || 'Invalid username or password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-theme-toggle-wrap">
        <ThemeToggle />
      </div>
      <div className="login-bg-pattern" aria-hidden="true">
        <span className="connection-line connection-line-1"></span>
        <span className="connection-line connection-line-2"></span>
        <span className="connection-line connection-line-3"></span>
        <span className="connection-line connection-line-4"></span>
        <span className="connection-node connection-node-1"></span>
        <span className="connection-node connection-node-2"></span>
        <span className="connection-node connection-node-3"></span>
        <span className="connection-node connection-node-4"></span>
        <span className="connection-node connection-node-5"></span>
        <span className="connection-node connection-node-6"></span>
      </div>

      <div className="login-layout">
        <div className="login-layout-left">
          <div className="login-container">
            <div className="login-branding">
              <div className="login-brand-content">
                <div className="login-brand-icon">
                  <FileText size={30} color="white" />
                </div>
                <h1 className="login-brand-title">DigiPath</h1>
                <p className="login-brand-subtitle">Vinzons Document Tracking System</p>
                <div className="login-brand-divider"></div>
                <p className="login-brand-desc">
                  Secure access to the municipal document management system. Scan, route, and track documents efficiently.
                </p>
              </div>
              <span className="login-brand-path login-brand-path-1"></span>
              <span className="login-brand-path login-brand-path-2"></span>
              <span className="login-brand-dot login-brand-dot-1"></span>
              <span className="login-brand-dot login-brand-dot-2"></span>
              <span className="login-brand-dot login-brand-dot-3"></span>
            </div>

            <div className="login-form-panel">
              <div className="login-form-wrapper">
                <div className="login-form-header">
                  <h2>Sign In</h2>
                  <p>Enter your credentials to access the system</p>
                </div>

                {error && (
                  <div className="login-error">
                    <AlertCircle size={16} />
                    {error}
                  </div>
                )}

                {!error && systemMessage && (
                  <div className="login-error login-error-info">
                    <AlertCircle size={16} />
                    {systemMessage}
                  </div>
                )}

                <form onSubmit={handleSubmit}>
                  <div className="form-group">
                    <label className="form-label">Username</label>
                    <input
                      className="form-input"
                      type="text"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="Enter your username"
                      required
                      autoFocus
                    />
                    <p className="field-hint">Use the username assigned to your DigiPath account.</p>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Password</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        className="form-input"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        required
                        style={{ paddingRight: '2.5rem' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="login-password-toggle"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <p className="field-hint">Enter the password linked to your municipal user account.</p>
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary login-submit-btn"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <span className="login-spinner"></span>
                        Signing in...
                      </>
                    ) : (
                      <>
                        <LogIn size={16} />
                        Sign In
                      </>
                    )}
                  </button>
                </form>

                <div className="login-tracking-panel">
                  <div className="login-tracking-header">
                    <Search size={16} />
                    <div>
                      <strong>Track Document</strong>
                      <span>Use the claim slip tracking number</span>
                    </div>
                  </div>

                  <form
                    className="login-tracking-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleTrackingLookup();
                    }}
                  >
                    <input
                      className="form-input"
                      type="text"
                      value={trackingNumber}
                      onChange={e => setTrackingNumber(e.target.value)}
                      placeholder="TRK-2026-0001"
                    />
                    <button
                      className="btn btn-secondary"
                      type="submit"
                      disabled={isTracking}
                      aria-label={isTracking ? 'Searching for document' : 'Track document'}
                    >
                      {isTracking ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                    </button>
                  </form>
                  <p className="field-hint">Enter the claim slip tracking number to open the latest public document status.</p>

                  {trackingError && !isTrackingModalOpen && (
                    <div className="login-tracking-message danger">
                      <AlertCircle size={14} />
                      {trackingError}
                    </div>
                  )}

                  {trackingResult && !isTrackingModalOpen && (
                    <div className="login-tracking-result">
                      <div className="login-tracking-status">
                        <CheckCircle2 size={15} />
                        <strong>{trackingResult.status}</strong>
                        <span>{trackingResult.intakeStatus}</span>
                        <button
                          type="button"
                          className="login-tracking-refresh"
                          onClick={() => handleTrackingLookup()}
                          disabled={isTracking}
                          title="Refresh tracking details"
                        >
                          {isTracking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                        </button>
                      </div>
                      <p>{trackingResult.subject}</p>

                      <div className="login-tracking-meta">
                        <span><FileText size={12} />{trackingResult.documentType}</span>
                        <span><Flag size={12} />{trackingResult.priorityLevel}</span>
                        <span><Clock size={12} />Received {trackingResult.dateReceived || 'not recorded'}</span>
                      </div>

                      <div className="login-tracking-route">
                        <span>{trackingResult.originOffice}</span>
                        <ArrowRight size={13} />
                        <strong>{trackingResult.currentOffice}</strong>
                        {trackingResult.destinationOffice && trackingResult.destinationOffice !== 'Not recorded' && (
                          <>
                            <ArrowRight size={13} />
                            <span>{trackingResult.destinationOffice}</span>
                          </>
                        )}
                      </div>

                      {trackingResult.rejectionReason && (
                        <div className="login-tracking-message danger">
                          <AlertCircle size={14} />
                          {trackingResult.rejectionReason}
                        </div>
                      )}

                      {!!trackingResult.transmissions?.length && (
                        <div className="login-tracking-updates">
                          {trackingResult.transmissions.slice(-3).map(item => (
                            <div key={item.id} className="login-tracking-update">
                              <MapPin size={12} />
                              <span>{item.fromOffice} to {item.toOffice}</span>
                              <strong>{item.status}</strong>
                            </div>
                          ))}
                        </div>
                      )}

                      {!!trackingResult.timeline?.length && (
                        <div className="login-tracking-timeline">
                          {trackingResult.timeline.slice(-4).reverse().map((item, index) => (
                            <div key={`${item.label}-${item.timestamp}-${index}`} className="login-tracking-timeline-item">
                              <span></span>
                              <div>
                                <strong>{item.label}</strong>
                                <small>{item.office} - {item.timestamp ? new Date(item.timestamp).toLocaleString() : 'recently'}</small>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <small>
                        <Clock size={13} />
                        Updated {trackingResult.updatedAt ? new Date(trackingResult.updatedAt).toLocaleString() : 'recently'}
                        {lastTrackingCheck ? ` - checked ${lastTrackingCheck.toLocaleTimeString()}` : ''}
                      </small>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="login-layout-right">
          <div className="login-seal-panel">
            <div className="login-seal-orbit" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
            </div>
            <img src="/Seal_of_Vinzons.png" alt="Seal of Vinzons" className="login-seal" />
          </div>
        </div>
      </div>

      {isTrackingModalOpen && (trackingResult || trackingError) && (
        <ModalOverlay overlayClassName="login-tracking-overlay" onClose={() => setIsTrackingModalOpen(false)}>
          <div className="modal login-tracking-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Document Tracking Status</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                  {trackingNumber || trackingResult?.trackingNumber || 'Tracking lookup'}
                </p>
              </div>
              <button className="btn-icon" onClick={() => setIsTrackingModalOpen(false)} aria-label="Close tracking status">
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              {trackingError && !trackingResult ? (
                <div className="login-tracking-message danger login-tracking-modal-message">
                  <AlertCircle size={16} />
                  {trackingError}
                </div>
              ) : (
                <div className="login-tracking-result login-tracking-result-modal">
                  <div className="login-tracking-status">
                    <CheckCircle2 size={15} />
                    <strong>{trackingResult.status}</strong>
                    <span>{trackingResult.intakeStatus}</span>
                    <button
                      type="button"
                      className="login-tracking-refresh"
                      onClick={() => handleTrackingLookup()}
                      disabled={isTracking}
                      title="Refresh tracking details"
                    >
                      {isTracking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    </button>
                  </div>
                  <p>{trackingResult.subject}</p>

                  <div className="login-tracking-meta">
                    <span><FileText size={12} />{trackingResult.documentType}</span>
                    <span><Flag size={12} />{trackingResult.priorityLevel}</span>
                    <span><Clock size={12} />Received {trackingResult.dateReceived || 'not recorded'}</span>
                  </div>

                  <div className="login-tracking-route">
                    <span>{trackingResult.originOffice}</span>
                    <ArrowRight size={13} />
                    <strong>{trackingResult.currentOffice}</strong>
                    {trackingResult.destinationOffice && trackingResult.destinationOffice !== 'Not recorded' && (
                      <>
                        <ArrowRight size={13} />
                        <span>{trackingResult.destinationOffice}</span>
                      </>
                    )}
                  </div>

                  {trackingResult.rejectionReason && (
                    <div className="login-tracking-message danger">
                      <AlertCircle size={14} />
                      {trackingResult.rejectionReason}
                    </div>
                  )}

                  {!!trackingResult.transmissions?.length && (
                    <div className="login-tracking-updates">
                      {trackingResult.transmissions.slice(-3).map(item => (
                        <div key={item.id} className="login-tracking-update">
                          <MapPin size={12} />
                          <span>{item.fromOffice} to {item.toOffice}</span>
                          <strong>{item.status}</strong>
                        </div>
                      ))}
                    </div>
                  )}

                  {!!trackingResult.timeline?.length && (
                    <div className="login-tracking-timeline">
                      {trackingResult.timeline.slice(-4).reverse().map((item, index) => (
                        <div key={`${item.label}-${item.timestamp}-${index}`} className="login-tracking-timeline-item">
                          <span></span>
                          <div>
                            <strong>{item.label}</strong>
                            <small>{item.office} - {item.timestamp ? new Date(item.timestamp).toLocaleString() : 'recently'}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <small>
                    <Clock size={13} />
                    Updated {trackingResult.updatedAt ? new Date(trackingResult.updatedAt).toLocaleString() : 'recently'}
                    {lastTrackingCheck ? ` - checked ${lastTrackingCheck.toLocaleTimeString()}` : ''}
                  </small>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-primary" onClick={() => setIsTrackingModalOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
};

export default LoginPage;
