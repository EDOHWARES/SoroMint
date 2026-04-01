import { Component } from 'react';
import ErrorFallback from './ErrorFallback';

/**
 * Error Boundary component that catches JavaScript errors anywhere in the child
 * component tree, logs those errors, and displays a fallback UI.
 *
 * Usage:
 * <ErrorBoundary>
 *   <MyComponent />
 * </ErrorBoundary>
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Generate a unique error ID for reference
    const errorId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    this.setState({
      error,
      errorInfo,
      errorId,
    });

    // Log error to console in development
    if (import.meta.env?.DEV) {
      console.error('Error caught by boundary:', error);
      console.error('Component stack:', errorInfo?.componentStack);
    }

    // Log to Sentry if configured
    this.logToSentry(error, errorInfo, errorId);
  }

  logToSentry(error, errorInfo, errorId) {
    // Check if Sentry is available and configured
    const Sentry = window?.Sentry;
    if (Sentry && import.meta.env?.VITE_SENTRY_DSN) {
      Sentry.withScope((scope) => {
        scope.setTag('errorBoundary', this.props.name || 'unknown');
        scope.setExtra('componentStack', errorInfo?.componentStack);
        scope.setExtra('errorId', errorId);
        Sentry.captureException(error);
      });
    }
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null,
    });
  };

  handleRefresh = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback component
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorFallback
          error={this.state.error}
          errorId={this.state.errorId}
          onRetry={this.handleRetry}
          onRefresh={this.handleRefresh}
          showDetails={import.meta.env?.DEV}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;