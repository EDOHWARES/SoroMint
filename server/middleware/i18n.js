/**
 * @title i18n Middleware
 * @description Middleware to handle internationalization in Express
 * @notice Uses i18next-http-middleware for language detection and translation
 */

const { initI18n, getI18n } = require('../config/i18n');
const middleware = require('i18next-http-middleware');

/**
 * @notice Create i18n middleware for Express
 * @dev Initializes i18next and returns the middleware handler
 * @returns {Function} Express middleware function
 */
const createI18nMiddleware = () => {
  // Initialize i18next
  const i18nInstance = initI18n({
    preferredLanguage: 'en',
  });

  // Create and return the middleware
  return middleware.handle(i18nInstance, middleware.LanguageDetector);
};

/**
 * @notice Get translation function from request
 * @dev Helper to get the t function from request object
 * @param {Object} req - Express request object
 * @returns {Function} Translation function
 */
const getTranslator = (req) => {
  return req.t.bind(req);
};

module.exports = {
  createI18nMiddleware,
  getTranslator,
  initI18n,
};
