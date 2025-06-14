const { PrismaClient } = require('@prisma/client');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const logger = require('../config/logger');
require('dotenv').config();

const prisma = new PrismaClient();

const uploadDir = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const addUserPhoto = async (userId, fileBuffer) => {
  logger.debug('photo.service - addUserPhoto appelé', { userId });

  const photoCount = await prisma.userPhoto.count({
    where: { userId }
  });

  if (photoCount >= 10) {
    logger.warn('photo.service - Trop de photos pour user', { userId });
    throw new Error('Vous ne pouvez pas ajouter plus de 10 photos');
  }

  const filename = `user_${userId}_${Date.now()}.jpeg`;
  const filepath = path.join(uploadDir, filename);

  logger.debug('photo.service - Processing image', { filename });

  await sharp(fileBuffer)
    .resize(800, 800, { fit: 'inside' })
    .jpeg({ quality: 80 })
    .toFile(filepath);

  const photoUrl = `${process.env.BASE_URL}/uploads/${filename}`;

  const photo = await prisma.userPhoto.create({
    data: {
      userId,
      url: photoUrl
    }
  });

  logger.info('photo.service - Photo ajoutée', { userId, photoId: photo.id });

  return photo;
};

async function deleteUserPhoto(userId, photoId) {
  logger.info('photo.service - Tentative suppression photo', { userId, photoId });

  const photo = await prisma.userPhoto.findUnique({
    where: { id: photoId },
  });

  if (!photo || photo.userId !== userId) {
    logger.warn('photo.service - Suppression interdite / photo inexistante', { userId, photoId });
    const error = new Error('Accès interdit ou photo introuvable');
    error.status = 403;
    throw error;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  const isProfilePhoto = user.photoUrl === photo.url;

  await prisma.userPhoto.delete({
    where: { id: photoId },
  });

  if (isProfilePhoto) {
    await prisma.user.update({
      where: { id: userId },
      data: { photoUrl: null },
    });
    logger.info('photo.service - Photo de profil supprimée', { userId });
  }

  logger.info('photo.service - Photo supprimée', { userId, photoId });

  return { photoId };
}

async function setUserProfilePhoto(userId, photoId) {
  logger.info('photo.service - Tentative set profile photo', { userId, photoId });

  const photo = await prisma.userPhoto.findUnique({
    where: { id: photoId },
  });

  if (!photo || photo.userId !== userId) {
    logger.warn('photo.service - Set profile photo interdit', { userId, photoId });
    const error = new Error('Accès interdit ou photo inexistante');
    error.status = 403;
    throw error;
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      photoUrl: photo.url,
    },
  });

  logger.info('photo.service - Photo de profil mise à jour', { userId, photoId });

  return { photoUrl: photo.url };
}

module.exports = {
  addUserPhoto,
  deleteUserPhoto,
  setUserProfilePhoto,
};
