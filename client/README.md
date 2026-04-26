# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Error Boundary

The application uses React Error Boundaries to gracefully handle UI crashes. When an error occurs, users see a friendly fallback page with options to retry or refresh.

### Features

- **Custom Fallback UI**: A user-friendly "Oops" page with refresh button
- **Error Logging**: Optional Sentry integration for production error tracking
- **Selective Wrapping**: Each route is wrapped individually, so errors in one page don't crash the entire app
- **Development Mode**: Error details are shown in development for easier debugging

### Sentry Integration (Optional)

To enable Sentry error logging in production:

1. Install the Sentry SDK:
   ```bash
   npm install @sentry/react
   ```

2. Create a `.env` file with your Sentry DSN:
   ```
   VITE_SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
   ```

3. Initialize Sentry in your app (see [Sentry React docs](https://docs.sentry.io/platforms/javascript/guides/react/)).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.