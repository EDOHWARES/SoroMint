import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { ToastContainer } from 'react-toastify';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import 'react-toastify/dist/ReactToastify.css';

import './i18n';
import './index.css';
import App from './App.jsx';
import ErrorBoundary from './components/error-boundary';
import { AppCrashPage } from './components/error-fallbacks';

// Early theme initialization to prevent flash
const initThemeEarly = () => {
  try {
    const stored = localStorage.getItem('ui-storage');
    let theme = 'system';
    if (stored) {
      theme = JSON.parse(stored).state?.theme || 'system';
    }
    
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;

    document.documentElement.classList.toggle('dark', resolved === 'dark');
  } catch (e) {
    console.warn('Early theme init failed', e);
  }
};

initThemeEarly();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <ErrorBoundary fallback={<AppCrashPage />}>
          <Routes>
            <Route path="/" element={<App />} />
          </Routes>
        </ErrorBoundary>
        <ToastContainer
          position="bottom-right"
          autoClose={4000}
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          pauseOnHover
          theme="colored"
        />
      </BrowserRouter>
    </HelmetProvider>
  </StrictMode>,
);