const { PrismaClient } = require('@prisma/client');
const logger = require('../config/logger');

const prisma = new PrismaClient();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

const getUserProfile = async (userId) => {
  logger.info('user.service - Tentative récupération profil', { userId });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      username: true,
      gender: true,
      bio: true,
      photoUrl: true,
      latitude: true,
      longitude: true,
      searchRadius: true,
      preferences: true,
      credits: true,
      createdAt: true,
      photos: {
        select: {
          id: true,
          url: true,
          createdAt: true
        }
      }
    }
  });

  if (!user) {
    logger.warn('user.service - Profil non trouvé', { userId });
    throw new Error('Utilisateur non trouvé');
  }

    user.photoUrl = user.photoUrl ? `${BASE_URL}${user.photoUrl}` : null;

  user.photos = user.photos.map(photo => ({
    ...photo,
    url: `${BASE_URL}${photo.url}`,
  }));

  logger.info('user.service - Profil récupéré', { userId });

  return user;
};

const updateUserProfile = async (userId, updatedFields) => {
  logger.info('user.service - Tentative MAJ profil', { userId, updatedFields });

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      username: updatedFields.username,
      bio: updatedFields.bio
    }
  });

  logger.info('user.service - Profil MAJ effectué', { userId });

  return user;
};

module.exports = { getUserProfile, updateUserProfile };
