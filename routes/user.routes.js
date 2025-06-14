const express = require('express');
const router = express.Router();

const authenticate = require('../middlewares/authenticateToken');
const userService = require('../services/user.service');
const logger = require('../config/logger');

// Middleware d'authentification
router.use(authenticate);

// GET /profile
router.get('/profile', async (req, res, next) => {
  try {
    logger?.info('GET /profile - Récupération profil', { userId: req.user.id });
    const profile = await userService.getUserProfile(req.user.id);
    logger?.info('GET /profile - Profil récupéré', { userId: req.user.id });

    res.json({ success: true, data: profile });
  } catch (error) {
    logger?.error('GET /profile - Erreur', { error });
    next(error);
  }
});

// PUT /profile
router.put('/profile', async (req, res, next) => {
  try {
    logger?.info('PUT /profile - MAJ profil', { userId: req.user.id, body: req.body });
    const updated = await userService.updateUserProfile(req.user.id, req.body);

    res.json({ success: true, data: updated });
  } catch (error) {
    logger?.error('PUT /profile - Erreur', { error });
    next(error);
  }
});

// PUT /nickname
router.put('/nickname', async (req, res, next) => {
  try {
    const { nickname } = req.body;
    console.log('[ROUTE /nickname] Body reçu:', req.body);
    console.log('[ROUTE /nickname] User:', req.user);
    
    if (!nickname) {
      return res.status(400).json({
        success: false,
        message: 'Nickname manquant dans la requête'
      });
    }
    
    const updated = await userService.updateNickname(req.user.id, nickname);
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('[ROUTE /nickname] Erreur:', error);
    next(error);
  }
});

// PUT /location
router.put('/location', async (req, res, next) => {
  try {
    const { latitude, longitude } = req.body;
    const updated = await userService.updateLocation(req.user.id, latitude, longitude);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

// GET /stats
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await userService.getUserStats(req.user.id);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
