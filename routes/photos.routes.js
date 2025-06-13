const express = require('express');
const authenticateToken = require('../middlewares/authenticateToken');
const upload = require('../config/multerConfig');
const { addUserPhoto, deleteUserPhoto, setUserProfilePhoto } = require('../services/photo.service');
const logger = require('../config/logger');

const router = express.Router();

// Ajout de photo
router.post('/photos', authenticateToken, upload.single('photo'), async (req, res, next) => {
  try {
    if (!req.file) {
      logger.warn('POST /photos - Aucun fichier reçu');
      return res.status(400).json({
        success: false,
        message: 'Aucun fichier reçu',
      });
    }

    logger.info('POST /photos - Tentative ajout photo', { userId: req.user.id });

    const photo = await addUserPhoto(req.user.id, req.file.buffer);

    logger.info('POST /photos - Photo ajoutée', { userId: req.user.id, photoId: photo.id });

    res.status(201).json({
      success: true,
      message: 'Photo ajoutée',
      data: photo
    });
  } catch (error) {
    logger.error('POST /photos - Erreur', { error });
    next(error);
  }
});

// Suppression de photo
router.delete('/photos/:photoId', authenticateToken, async (req, res, next) => {
  try {
    const photoId = parseInt(req.params.photoId, 10);
    logger.info('DELETE /photos/:photoId - Tentative suppression photo', { userId: req.user.id, photoId });

    const result = await deleteUserPhoto(req.user.id, photoId);

    logger.info('DELETE /photos/:photoId - Photo supprimée', { userId: req.user.id, photoId });

    res.json({
      success: true,
      message: 'Photo supprimée',
      ...result,
    });
  } catch (error) {
    logger.error('DELETE /photos/:photoId - Erreur', { error });
    next(error);
  }
});

router.post('/photos/profile', authenticateToken, async (req, res, next) => {
  try {
    const { photoId } = req.body;

    if (!photoId) {
      logger.warn('POST /photos/profile - photoId manquant');
      return res.status(400).json({
        success: false,
        message: 'photoId manquant',
      });
    }

    logger.info('POST /photos/profile - Tentative set profile photo', { userId: req.user.id, photoId });

    const result = await setUserProfilePhoto(req.user.id, photoId);

    logger.info('POST /photos/profile - Photo de profil mise à jour', { userId: req.user.id, photoId });

    res.json({
      success: true,
      message: 'Photo de profil mise à jour',
      ...result,
    });
  } catch (error) {
    logger.error('POST /photos/profile - Erreur', { error });
    next(error);
  }
});

module.exports = router;
