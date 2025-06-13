const express = require('express');
const { loginLimiter, signupLimiter } = require('../middlewares/ratelimiter');
const validateSignup = require('../middlewares/ValidateSignup');
const { signup, login } = require('../services/auth.service');
const logger = require('../config/logger');

const router = express.Router();

router.post('/signup', signupLimiter, validateSignup, async (req, res, next) => {
  try {
    logger.info('POST /signup - Tentative inscription', { email: req.body.email });

    const { user, token } = await signup(req.body);

    logger.info('POST /signup - Inscription réussie', { userId: user.id });

    res.status(201).json({
      success: true,
      message: 'Inscription réussie',
      data: { user, token }
    });
  } catch (error) {
    logger.error('POST /signup - Erreur', { error });
    next(error);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      logger.warn('POST /login - Email ou mot de passe manquant');
      return res.status(400).json({
        success: false,
        message: 'Email et mot de passe requis'
      });
    }

    logger.info('POST /login - Tentative connexion', { email });

    const { user, token } = await login(email, password);

    logger.info('POST /login - Connexion réussie', { userId: user.id });

    res.status(200).json({
      success: true,
      message: 'Connexion réussie',
      data: { user, token }
    });
  } catch (error) {
    logger.error('POST /login - Erreur', { error });
    next(error);
  }
});

module.exports = router;
