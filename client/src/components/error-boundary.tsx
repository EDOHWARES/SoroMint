import React, { Component, ReactNode } from 'react';
import { logFrontendError } from '../utils/error-logger';

interface ErrorBoundaryProps {
  children: ReactNode;
  resetKeys?: unknown[];
  onReset?: () => void;
  fallback?: ReactNode;
  fallbackRender?: (props: { error: Error; resetErrorBoundary: () => void }) => ReactNode;
  context?: Record<string, unknown>;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function haveResetKeysChanged(prevResetKeys: unknown[] | undefined, nextResetKeys: unknown[] | undefined): boolean {
  if (prevResetKeys === nextResetKeys) {
    return false;
  }

  if (!Array.isArray(prevResetKeys) || !Array.isArray(nextResetKeys)) {
    return false;
  }

  if (prevResetKeys.length !== nextResetKeys.length) {
    return true;
  }

  return prevResetKeys.some((key, index) => !Object.is(key, nextResetKeys[index]));
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    logFrontendError(error, errorInfo, this.props.context);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error &&
      haveResetKeysChanged(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.resetErrorBoundary();
    }
  }

  resetErrorBoundary = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.error) {
      if (typeof this.props.fallbackRender === 'function') {
        return this.props.fallbackRender({
          error: this.state.error,
          resetErrorBoundary: this.resetErrorBoundary,
        });
      }

      return this.props.fallback ?? null;
    }

    return this.props.children;
  }
}

export default ErrorBoundary;