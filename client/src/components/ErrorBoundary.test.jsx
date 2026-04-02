import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

// Suppress console.error during tests
const originalError = console.error;

describe('ErrorBoundary', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  // Component that throws an error when shouldThrow is true
  const ThrowError = ({ shouldThrow }) => {
    if (shouldThrow) {
      throw new Error('Test error');
    }
    return <div>No error</div>;
  };

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Test content</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('renders fallback UI when an error is thrown', () => {
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

// Mock component that throws an error
const ThrowError = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>No error</div>;
};

// Suppress console.error during tests
const originalError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('No error')).toBeInTheDocument();
  });

  it('renders fallback UI when error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    // Check for error message from ErrorFallback
    expect(screen.getByText(/Oops! Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/unexpected error/i)).toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    const customFallback = <div>Custom error UI</div>;
    
    render(
      <ErrorBoundary fallback={customFallback}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom error UI')).toBeInTheDocument();
  });

  it('has a refresh button that reloads the page', () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock, href: '/' },
      writable: true,
    });
    expect(screen.getByText('Oops! Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('We encountered an unexpected error. Please try refreshing the page.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
  });

  it('displays error details in development mode', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    const refreshButton = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshButton);

    expect(reloadMock).toHaveBeenCalled();
  });

  it('can reset error state when showReset is true', () => {
    render(
      <ErrorBoundary showReset={true}>
    expect(screen.getByText(/Error: Test error/)).toBeInTheDocument();
    expect(screen.getByText('View stack trace')).toBeInTheDocument();

    process.env.NODE_ENV = originalEnv;
  });

  it('hides error details in production mode', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    // After error, should show fallback
    expect(screen.getByText(/Oops! Something went wrong/i)).toBeInTheDocument();
    
    // Click reset button
    const resetButton = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(resetButton);
    
    // After reset, the error boundary state is cleared
    // The ThrowError component will throw again since shouldThrow is still true
    // But we can verify the state was reset by checking componentDidCatch was called again
    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
  });

  it('logs error to console', () => {
    render(
      <ErrorBoundary name="TestBoundary">
    expect(screen.queryByText(/Error: Test error/)).not.toBeInTheDocument();

    process.env.NODE_ENV = originalEnv;
  });

  it('calls console.error when error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('accepts name prop for error identification', () => {
    render(
      <ErrorBoundary name="CustomBoundary">
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
    expect(console.error).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      'ErrorBoundary caught an error:',
      expect.any(Error),
      expect.any(Object)
    );
  });
});

  it('clears error state when Try Again button is clicked', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    // Error UI should be visible
    expect(screen.getByText('Oops! Something went wrong')).toBeInTheDocument();

    // Click the Try Again button
    const tryAgainButton = screen.getByRole('button', { name: 'Try Again' });
    fireEvent.click(tryAgainButton);

    // Rerender with no error
    rerender(
      <ErrorBoundary>
        <ThrowError shouldThrow={false} />
      </ErrorBoundary>
    );

    // Child component should be visible now
    expect(screen.getByText('No error')).toBeInTheDocument();
  });

  it('has correct accessibility attributes', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    const alertDiv = screen.getByRole('alert');
    expect(alertDiv).toHaveAttribute('aria-live', 'assertive');
  });

  it('renders support message', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('If the problem persists, please contact support.')).toBeInTheDocument();
  });
});
