const Sentry = require('@sentry/node');

let initialized = false;

const initSentry = (app) => {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn || process.env.NODE_ENV === 'test') return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  });

  initialized = true;
};

const captureException = (err, context = {}) => {
  if (!initialized) return;

  Sentry.withScope((scope) => {
    if (context.user) scope.setUser(context.user);
    if (context.req) {
      scope.setTag('method', context.req.method);
      scope.setTag('path', context.req.originalUrl);
      scope.setExtra('correlationId', context.req.correlationId);
    }
    Sentry.captureException(err);
  });
};

const addBreadcrumb = (message, data = {}) => {
  if (!initialized) return;
  Sentry.addBreadcrumb({ message, data, level: 'info' });
};

module.exports = { initSentry, captureException, addBreadcrumb };
