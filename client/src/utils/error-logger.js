function getSentryClient() {
  if (typeof globalThis === 'undefined') {
    return null
  }

  if (globalThis.Sentry?.captureException) {
    return globalThis.Sentry
  }

  if (globalThis.__SENTRY__?.captureException) {
    return globalThis.__SENTRY__
  }

  return null
}

export function logFrontendError(error, errorInfo, context = {}) {
  const sentry = getSentryClient()

  if (sentry) {
    sentry.captureException(error, {
      extra: {
        componentStack: errorInfo?.componentStack,
        ...context,
      },
    })

    return
  }

  if (import.meta.env.DEV) {
    console.error('Unhandled UI error', error, errorInfo, context)
  }
}
