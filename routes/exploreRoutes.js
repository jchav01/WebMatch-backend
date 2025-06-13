const express = require('express');
const router = express.Router();
const exploreService = require('../services/exploreService');

router.get('/random-user', async (req, res) => {
  try {
    const userId = req.user?.id || 0; // ou un ID fixe temporaire pour tester

    const randomUser = await exploreService.getRandomUser(userId);

    if (!randomUser) {
      return res.status(404).json({ message: 'Aucun utilisateur trouvé.' });
    }

    res.json(randomUser);
  } catch (error) {
    console.error('Erreur random-user:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;

