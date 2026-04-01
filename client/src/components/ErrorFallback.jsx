import { RefreshCw, AlertTriangle, Home } from 'lucide-react';

/**
 * Fallback UI displayed when an error is caught by the Error Boundary.
 * Shows a friendly "Oops" page with options to retry or refresh.
 */
function ErrorFallback({ error, errorId, onRetry, onRefresh, showDetails = false }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      role="alert"
      aria-live="assertive"
    >
      <div className="glass-card max-w-md w-full text-center">
        {/* Error Icon */}
        <div className="mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20">
            <AlertTriangle
              className="w-8 h-8 text-red-400"
              aria-hidden="true"
            />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-white mb-2">
          Oops! Something went wrong
        </h1>

        {/* Description */}
        <p className="text-slate-400 mb-6">
          We encountered an unexpected error. Don't worry, you can try again or refresh the page.
        </p>

        {/* Error ID for support reference */}
        {errorId && (
          <p className="text-xs text-slate-500 mb-6 font-mono">
            Error ID: {errorId}
          </p>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={onRetry}
            className="btn-primary flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            aria-label="Try again"
          >
            <RefreshCw size={18} aria-hidden="true" />
            <span>Try Again</span>
          </button>

          <button
            onClick={onRefresh}
            className="flex items-center justify-center gap-2 px-6 py-2 rounded-lg border border-white/10 text-slate-300 hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            aria-label="Refresh page"
          >
            <Home size={18} aria-hidden="true" />
            <span>Refresh Page</span>
          </button>
        </div>

        {/* Error Details (Development Only) */}
        {showDetails && error && (
          <details className="mt-6 text-left">
            <summary className="cursor-pointer text-sm text-slate-500 hover:text-slate-400 transition-colors">
              View Error Details
            </summary>
            <div className="mt-3 p-4 bg-black/20 rounded-lg overflow-auto">
              <p className="text-red-400 font-mono text-sm break-words">
                {error.message || 'Unknown error'}
              </p>
              {error.stack && (
                <pre className="text-slate-500 text-xs mt-2 overflow-auto max-h-32">
                  {error.stack}
                </pre>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export default ErrorFallback;