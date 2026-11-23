import { focusFormError } from '../utils/formAccessibility';
import React, { useId, useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Eye, EyeOff, FileText, Flag, Loader2, LogIn, MapPin, RefreshCw, Search, X } from 'lucide-react';
import { authService, trackingService } from '../api/documentService';
import { watchTrackingNumber } from '../utils/publicTracking';
import { formatPhilippinesDateTime, formatPhilippinesDateParts } from '../utils/philippinesDateTime';
import ModalOverlay from '../components/ModalOverlay';
import ThemeToggle from '../components/ThemeToggle';

const LoginPage = ({ onLogin, systemMessage = '' }) => {
  const formId = useId();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordHidden, setPasswordHidden] = useState(true);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tracking') || '';
  });
  const [submittedNumber, setSubmittedNumber] = useState(() => trackingNumber.trim());
  const [lookup, setLookup] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const current = lookup?.number === submittedNumber ? lookup : null;
  const trackingResult = current?.result;
  const trackingError = current?.error;
  const isTracking = !current || current.loading;
  const lastTrackingCheck = current?.checked;

  const getTrackingRoute = (result) => {
    if (!result) return { from: 'Not recorded', to: 'Not recorded' };

    // Prefer the actual send/route hop — never insert currentOffice in the middle
    // (that caused "Mayor's → Mayor's → Dest" when origin and current matched).
    const latestTransmission = Array.isArray(result.transmissions) && result.transmissions.length
      ? result.transmissions[result.transmissions.length - 1]
      : null;
    if (latestTransmission?.fromOffice && latestTransmission?.toOffice) {
      return { from: latestTransmission.fromOffice, to: latestTransmission.toOffice };
    }

    const origin = result.originOffice || 'Not recorded';
    const destination = result.destinationOffice && result.destinationOffice !== 'Not recorded'
      ? result.destinationOffice
      : '';
    if (destination) {
      return { from: origin, to: destination };
    }
    return { from: origin, to: result.currentOffice || 'Not recorded' };
  };

  const renderTrackingRoute = (result) => {
    const route = getTrackingRoute(result);
    const sameOffice = String(route.from).trim().toLowerCase() === String(route.to).trim().toLowerCase();
    if (sameOffice) {
      return (
        <div className="login-tracking-route">
          <strong>{route.to}</strong>
        </div>
      );
    }
    return (
      <div className="login-tracking-route">
        <span>{route.from}</span>
        <ArrowRight size={13} />
        <strong>{route.to}</strong>
      </div>
    );
  };

  useEffect(() => watchTrackingNumber(submittedNumber, trackingService.track, setLookup), [submittedNumber, refresh]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const panel = e.currentTarget.parentElement;
    setError('');
    setIsLoading(true);

    try {
      const user = await authService.login(username, password);
      await onLogin(user);
    } catch (err) {
      setError(err.message || 'Invalid username or password');
      focusFormError(panel);
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

      <div className="login-layout civic-entry">
        <div className="login-container">
          <section className="login-branding" aria-labelledby={`${formId}-track-entry`}>
            <div className="login-brand-content">
              <div className="civic-signature">
                <img src="/Seal_of_Vinzons.png" alt="Municipality of Vinzons" width="68" height="68" />
                <div>
                  <h1 className="login-brand-title">DigiPath</h1>
                  <p className="login-brand-subtitle">Vinzons Document Tracking System</p>
                </div>
              </div>
              <div className="login-brand-divider" />
              <h2 id={`${formId}-track-entry`}>Track a document</h2>
              <p id={`${formId}-tracking-hint`}>Enter the tracking number printed on your claim slip.</p>
              <form className="login-tracking-form" onSubmit={event => {
                event.preventDefault();
                setSubmittedNumber(trackingNumber.trim());
              }}>
                <label htmlFor={`${formId}-tracking`}>Tracking number</label>
                <input id={`${formId}-tracking`} aria-label="Tracking number" aria-describedby={`${formId}-tracking-hint`}
                  className="form-input" value={trackingNumber} placeholder="TRK-2026-0001" required
                  pattern=".*\S.*" onChange={event => setTrackingNumber(event.target.value)} />
                <button className="btn btn-secondary" type="submit" aria-label="Track document"><Search size={16} /> Track</button>
              </form>
            </div>
          </section>

            <div className="login-form-panel">
              <div className="login-form-wrapper">
                <div className="login-form-header">
                  <h2>Staff sign-in</h2>
                  <p>Use your municipal staff account.</p>
                </div>

                {error && (
                  <div id={`${formId}-login-error`} data-form-error tabIndex={-1} role="alert" className="login-error">
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

                <form onSubmit={handleSubmit} aria-describedby={error ? `${formId}-login-error` : undefined}>
                  <div className="form-group">
                    <label htmlFor={`${formId}-username`} className="form-label">Username</label>
                    <input autoComplete="username" id={`${formId}-username`} aria-describedby={`${formId}-username-hint`}
                      className="form-input"
                      type="text"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="Enter your username"
                      required
                    />
                    <p id={`${formId}-username-hint`} className="field-hint">Use the username assigned to your DigiPath account.</p>
                  </div>

                  <div className="form-group">
                    <label htmlFor={`${formId}-password`} className="form-label">Password</label>
                    <div style={{ position: 'relative' }}>
                      <input id={`${formId}-password`} aria-describedby={`${formId}-password-hint`}
                        className="form-input"
                        type={passwordHidden ? 'password' : 'text'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        required
                        autoComplete="current-password"
                        style={{ paddingRight: '2.5rem' }}
                      />
                      <button
                        type="button"
                        onClick={() => setPasswordHidden((hidden) => !hidden)}
                        className="login-password-toggle"
                        aria-label={passwordHidden ? 'Show password' : 'Hide password'}
                        aria-pressed={!passwordHidden}
                      >
                        {passwordHidden ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <p id={`${formId}-password-hint`} className="field-hint">Enter the password linked to your municipal user account.</p>
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

              </div>
            </div>
        </div>
      </div>

      {submittedNumber && (
        <ModalOverlay aria-labelledby={`${formId}-tracking-title`} overlayClassName="login-tracking-overlay" onClose={() => setSubmittedNumber('')}>
          <div className="modal login-tracking-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 id={`${formId}-tracking-title`}>Document Tracking Status</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                  {trackingResult?.trackingNumber || submittedNumber}
                </p>
              </div>
              <button className="btn-icon" onClick={() => setSubmittedNumber('')} aria-label="Close tracking status">
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              {isTracking && <p role="status">{trackingResult ? 'Refreshing status…' : 'Looking up document…'}</p>}
              {trackingError && (
                <div className="login-tracking-message danger" role="alert">
                  <AlertCircle size={16} />
                  <span>{trackingResult && 'Showing the last verified status. '}{trackingError}</span>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={isTracking} onClick={() => setRefresh(value => value + 1)}>Retry</button>
                </div>
              )}
              {trackingResult && (
                <div className="login-tracking-result login-tracking-result-modal">
                  <div className="login-tracking-status">
                    <CheckCircle2 size={15} />
                    <strong>{trackingResult.status}</strong>
                    <span>{trackingResult.intakeStatus}</span>
                    <button
                      type="button"
                      className="login-tracking-refresh"
                      onClick={() => setRefresh(value => value + 1)}
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

                  <p>Recorded holder · <strong>{trackingResult.currentOffice || 'Not recorded'}</strong></p>
                  {renderTrackingRoute(trackingResult)}

                  {trackingResult.rejectionReason && (
                    <div className="login-tracking-message danger">
                      <AlertCircle size={14} />
                      {trackingResult.rejectionReason}
                    </div>
                  )}

                  {trackingResult.transmissions?.length > 1 && (
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
                            <small>{item.office} - {item.timestamp ? formatPhilippinesDateTime(item.timestamp) : 'recently'}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <small>
                    <Clock size={13} />
                    Updated {trackingResult.updatedAt ? formatPhilippinesDateTime(trackingResult.updatedAt) : 'recently'}
                    {lastTrackingCheck ? ` - checked ${formatPhilippinesDateParts(lastTrackingCheck).time}` : ''}
                  </small>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-primary" onClick={() => setSubmittedNumber('')}>
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
