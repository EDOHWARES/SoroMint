import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HelmetProvider } from 'react-helmet-async'
import { ToastContainer } from 'react-toastify'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import 'react-toastify/dist/ReactToastify.css'
import './i18n'
import './index.css'
import { AppRoot } from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppRoot />
import App from './App.jsx'
import ProfilePage from './components/ProfilePage.jsx'
import ErrorBoundary from './components/ErrorBoundary'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Initialize theme from localStorage before React loads to prevent flash
const initThemeEarly = () => {
  const stored = localStorage.getItem('ui-storage');
  let theme = 'system';
  
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      theme = parsed.state?.theme || 'system';
    } catch (e) {
      theme = 'system';
    }
  }
  
  const resolved = theme === 'system' 
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
  } else {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
  }
};

// Run early theme initialization
initThemeEarly();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Routes>
        </ErrorBoundary>
        <Routes>
          <Route
            path="/"
            element={
              <ErrorBoundary name="App">
                <App />
              </ErrorBoundary>
            }
          />
          <Route
            path="/profile"
            element={
              <ErrorBoundary name="ProfilePage">
                <ProfilePage />
              </ErrorBoundary>
            }
          />
        </Routes>
      </BrowserRouter>
      <ToastContainer
        position="bottom-right"
        autoClose={4000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnHover
        theme="dark"
      />
    </HelmetProvider>
  </StrictMode>,
)