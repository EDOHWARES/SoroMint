/**
 * @title i18next Configuration
 * @description Internationalization configuration for error messages and API responses
 * @notice Supports multiple languages via Accept-Language header detection
 * @languages Supported: English (en), Spanish (es), French (fr), Arabic (ar)
 */

const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const middleware = require('i18next-http-middleware');
const path = require('path');

/**
 * @notice Initialize i18next with translation resources
 * @dev Loads translation files from the locales directory
 * @param {Object} options - Configuration options
 * @param {string} options.preferredLanguage - Fallback language (default: 'en')
 * @returns {Object} Configured i18next instance
 */
const initI18n = (options = {}) => {
  const { preferredLanguage = 'en' } = options;

  return i18next.use(Backend).use(middleware.LanguageDetector).init({
    // Load translations from filesystem
    backend: {
      loadPath: path.join(__dirname, '..', 'locales', '{{lng}}', '{{ns}}.json'),
      addPath: path.join(__dirname, '..', 'locales', '{{lng}}', '{{ns}}.json'),
    },
    supportedLngs: ['en', 'es', 'fr', 'ar'],
    fallbackLng: preferredLanguage,
    preload: ['en', 'es', 'fr', 'ar'],
    detection: {
      order: ['querystring', 'cookie', 'header'],
      queryStringKey: 'lang',
      cookieKey: 'i18next',
      header: 'accept-language',
      cookieMinutes: 1440,
    },
    ns: ['errors'],
    defaultNS: 'errors',
    debug: process.env.NODE_ENV !== 'production',
    escapeValue: false,
    keySeparator: false,
    nsSeparator: false,
    pluralSuffix: 'plural',
  });
};

/**
 * @notice Get i18next instance
 * @dev Should be called after initI18n
 * @returns {Object} i18next instance
 */
const getI18n = () => {
  if (!i18next.isInitialized) {
    throw new Error('i18next not initialized. Call initI18n() first.');
  }
  return i18next;
};

module.exports = {
  initI18n,
  getI18n,
};
