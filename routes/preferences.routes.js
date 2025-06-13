const express = require('express');
const router = express.Router();
const preferencesService = require('../services/preferences.service');
const authenticateToken = require('../middlewares/authenticateToken');

router.get('/', authenticateToken, async (req, res) => {
  try {
    const preferences = await preferencesService.getUserPreferences(req.user.id);
    res.json({ success: true, preferences });
  } catch (error) {
    console.error('Erreur get preferences:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

router.put('/', authenticateToken, async (req, res) => {
  try {
    const preferences = req.body.preferences;
    const updatedPreferences = await preferencesService.updateUserPreferences(req.user.id, preferences);
    res.json({ success: true, preferences: updatedPreferences });
  } catch (error) {
    console.error('Erreur update preferences:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

module.exports = router;
