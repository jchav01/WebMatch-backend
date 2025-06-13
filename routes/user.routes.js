const express = require('express');
const authenticateToken = require('../middlewares/authenticateToken');
const { getUserProfile, updateUserProfile } = require('../services/user.service');
const logger = require('../config/logger');

const router = express.Router();

router.get('/profile', authenticateToken, async (req, res, next) => {
  try {
    logger.info('GET /profile - Récupération profil', { userId: req.user.id });

    const user = await getUserProfile(req.user.id);

    logger.info('GET /profile - Profil récupéré', { userId: req.user.id });

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    logger.error('GET /profile - Erreur', { error });
    next(error);
  }
});

router.put('/profile', authenticateToken, async (req, res, next) => {
  try {
    logger.info('PUT /profile - MAJ profil', { userId: req.user.id, body: req.body });

    const updatedUser = await updateUserProfile(req.user.id, req.body);

    res.json({
      success: true,
      data: updatedUser
    });
  } catch (error) {
    logger.error('PUT /profile - Erreur', { error });
    next(error);
  }
});

module.exports = router;
