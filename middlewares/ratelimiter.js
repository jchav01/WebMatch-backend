const rateLimit = require('express-rate-limit');

const createRateLimiter = (maxRequests, windowMinutes, message) => {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message
    }
  });
};

const loginLimiter = createRateLimiter(5, 15, 'Trop de tentatives de connexion, veuillez réessayer dans 15 minutes.');
const signupLimiter = createRateLimiter(3, 60, 'Trop de tentatives de création de compte, veuillez réessayer dans 1 heure.');

module.exports = { loginLimiter, signupLimiter };
