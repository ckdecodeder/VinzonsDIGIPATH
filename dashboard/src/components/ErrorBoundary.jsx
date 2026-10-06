import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="card error-boundary-card">
        <AlertCircle size={22} />
        <div>
          <h3>Something went wrong</h3>
          <p>{this.state.error.message || 'The page could not be displayed. Try refreshing this view.'}</p>
          <button className="btn btn-secondary btn-sm" onClick={() => this.setState({ error: null })}>
            <RefreshCw size={14} /> Try Again
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
