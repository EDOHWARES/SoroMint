import { Component } from 'react';
import ErrorFallback from './ErrorFallback.jsx';

/**
 * Error Boundary component to catch React rendering errors
 * and display a friendly fallback UI instead of a white screen.
 * 
 * Requirements from Issue #98:
 * - Custom "Oops" page with a refresh button
 * - Error logging to Sentry (if integrated)
 * - Selective wrapping of risky components
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render shows the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log error to console in development
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    this.setState({ errorInfo });

    // Log to Sentry if available
    this.logToSentry(error, errorInfo);
  }

  logToSentry(error, errorInfo) {
    // Check if Sentry is available on window (client-side)
    if (typeof window !== 'undefined' && window.__SENTRY__) {
      try {
        const Sentry = window.__SENTRY__;
        Sentry.withScope((scope) => {
          if (errorInfo && errorInfo.componentStack) {
            scope.setExtra('componentStack', errorInfo.componentStack);
          }
          if (this.props.name) {
            scope.setTag('errorBoundary', this.props.name);
          }
          Sentry.captureException(error);
        });
      } catch (e) {
        console.warn('Failed to log to Sentry:', e);
      }
    }
  }

  handleRefresh = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Use ErrorFallback component for the UI
      return (
        <ErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onRefresh={this.handleRefresh}
          onReset={this.props.showReset ? this.handleReset : undefined}
          showReset={this.props.showReset !== false}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

/**
 * Higher-order component to wrap components with ErrorBoundary
 * @param {React.Component} WrappedComponent - Component to wrap
 * @param {Object} options - Options for the ErrorBoundary
 * @returns {React.Component} Wrapped component with error boundary
 */
export function withErrorBoundary(WrappedComponent, options = {}) {
  const { name, fallback, showReset } = options;
  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component';
  
  const ComponentWithErrorBoundary = (props) => (
    <ErrorBoundary name={name || displayName} fallback={fallback} showReset={showReset}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  ComponentWithErrorBoundary.displayName = `withErrorBoundary(${displayName})`;
  
  return ComponentWithErrorBoundary;
}
