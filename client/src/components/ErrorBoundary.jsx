import React from 'react';
import ErrorFallback from './ErrorFallback';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render shows the fallback UI.
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
import React from 'react';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';

/**
 * Error Boundary component to catch JavaScript errors anywhere in the child component tree
 * and display a friendly fallback UI instead of a white screen.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render shows the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // You can also log the error to an error reporting service
    this.setState({ errorInfo });
    this.logErrorToSentry(error, errorInfo);
  }

  logErrorToSentry(error, errorInfo) {
    // Check if Sentry is available (window.Sentry)
    if (window.Sentry) {
      window.Sentry.captureException(error, {
        extra: { errorInfo },
        tags: { componentStack: errorInfo?.componentStack },
      });
    } else {
      // Fallback to console.error
      console.error('Error caught by ErrorBoundary:', error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    // Optionally navigate to home
    if (window.location.pathname !== '/') {
      window.location.href = '/';
    }
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
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Generate a unique error ID for tracking
    const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.setState({
      error,
      errorInfo,
      errorId
    });

    // Log error to console for development
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // Log to Sentry if available
    if (typeof window !== 'undefined' && window.Sentry) {
      window.Sentry.captureException(error, {
        contexts: {
          react: {
            componentStack: errorInfo.componentStack
          }
        },
        tags: {
          errorBoundary: this.props.name || 'root'
        }
      });
    }

    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo, errorId);
    }
  }

  handleRefresh = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  handleGoHome = () => {
    window.location.href = '/';
  };

  handleRetry = () => {
    // Reset error state to retry rendering
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: null
    });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback if provided
      // Custom fallback UI if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Use ErrorFallback component for the UI
      return (
        <ErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onReset={this.handleReset}
        />
          onRefresh={this.handleRefresh}
          onReset={this.props.showReset ? this.handleReset : undefined}
          showReset={this.props.showReset !== false}
        />
      // Default fallback UI
      return (
        <div 
          className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4"
          role="alert"
          aria-live="assertive"
        >
          <div className="max-w-md w-full bg-white/5 backdrop-blur-lg rounded-2xl p-8 border border-white/10 shadow-xl">
            {/* Error Icon */}
            <div className="flex justify-center mb-6">
              <div className="bg-red-500/10 p-4 rounded-full">
                <AlertTriangle className="w-16 h-16 text-red-400" aria-hidden="true" />
              </div>
            </div>

            {/* Error Message */}
            <h1 className="text-3xl font-bold text-white text-center mb-2">
              Oops!
            </h1>
            <p className="text-slate-300 text-center mb-6">
              Something went wrong. We're sorry for the inconvenience.
            </p>

            {/* Error Details (collapsible for debugging) */}
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mb-6">
                <summary className="text-sm text-slate-400 cursor-pointer hover:text-slate-300 transition-colors">
                  View error details
                </summary>
                <div className="mt-3 p-3 bg-black/20 rounded-lg overflow-auto max-h-40">
                  <p className="text-xs font-mono text-red-400 mb-2">
                    {this.state.error.toString()}
                  </p>
                  {this.state.errorInfo && (
                    <pre className="text-xs font-mono text-slate-400 whitespace-pre-wrap">
                      {this.state.errorInfo.componentStack}
                    </pre>
                  )}
                </div>
              </details>
            )}

            {/* Error ID */}
            {this.state.errorId && (
              <p className="text-xs text-slate-500 text-center mb-6 font-mono">
                Error ID: {this.state.errorId}
              </p>
            )}

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={this.handleRefresh}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900"
                aria-label="Refresh the page"
              >
                <RefreshCw size={20} aria-hidden="true" />
                <span>Refresh Page</span>
              </button>

              <button
                onClick={this.handleRetry}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-slate-900"
                aria-label="Try again"
              >
                <Bug size={20} aria-hidden="true" />
                <span>Try Again</span>
              </button>

              <button
                onClick={this.handleGoHome}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 text-slate-300 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-slate-900"
                aria-label="Go to home page"
              >
                <Home size={20} aria-hidden="true" />
                <span>Go to Home</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
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
export default ErrorBoundary;
