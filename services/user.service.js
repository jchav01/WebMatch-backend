const { PrismaClient } = require('@prisma/client');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');

const prisma = new PrismaClient();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

// ========== VALIDATION ==========

const validateNickname = (nickname) => {
  if (!nickname || nickname.trim().length === 0) {
    throw new AppError('Le pseudo ne peut pas être vide', 400);
  }
  
  if (nickname.length < 2) {
    throw new AppError('Le pseudo doit contenir au moins 2 caractères', 400);
  }
  
  if (nickname.length > 30) {
    throw new AppError('Le pseudo ne peut pas dépasser 30 caractères', 400);
  }
  
  // Caractères autorisés : lettres, chiffres, espaces, tirets, underscores
  const nicknameRegex = /^[a-zA-Z0-9À-ÿ\s\-_]+$/;
  if (!nicknameRegex.test(nickname)) {
    throw new AppError('Le pseudo contient des caractères non autorisés', 400);
  }
  
  // Pas de mots interdits
  const forbiddenWords = ['admin', 'moderator', 'system', 'webmatch', 'modo', 'staff'];
  const nicknameLower = nickname.toLowerCase();
  for (const word of forbiddenWords) {
    if (nicknameLower.includes(word)) {
      throw new AppError('Ce pseudo n\'est pas autorisé', 400);
    }
  }
  
  return true;
};

// ========== RÉCUPÉRATION DU PROFIL ==========

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
      nickname: true,
      gender: true,
      bio: true,
      photoUrl: true,
      dateOfBirth: true,
      latitude: true,
      longitude: true,
      city: true,
      country: true,
      searchRadius: true,
      preferences: true,
      credits: true,
      isPremium: true,
      premiumUntil: true,
      isVerified: true,
      emailVerified: true,
      lastSeen: true,
      createdAt: true,
      photos: {
        select: {
          id: true,
          url: true,
          isProfile: true,
          order: true,
          createdAt: true
        },
        orderBy: { order: 'asc' }
      }
    }
  });

  if (!user) {
    logger.warn('user.service - Profil non trouvé', { userId });
    throw new AppError('Utilisateur non trouvé', 404);
  }

  // Ajouter l'URL complète pour la photo de profil
  if (user.photoUrl) {
    user.photoUrl = user.photoUrl.startsWith('http') 
      ? user.photoUrl 
      : `${BASE_URL}${user.photoUrl}`;
  }

  // Ajouter l'URL complète pour toutes les photos
  user.photos = user.photos.map(photo => ({
    ...photo,
    url: photo.url.startsWith('http') 
      ? photo.url 
      : `${BASE_URL}${photo.url}`,
  }));

  // Calculer l'âge
  if (user.dateOfBirth) {
    const today = new Date();
    const birthDate = new Date(user.dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    user.age = age;
  }

  logger.info('user.service - Profil récupéré', { userId });

  return user;
};

// ========== MISE À JOUR DU PROFIL ==========

const updateUserProfile = async (userId, updatedFields) => {

  const forbiddenFields = ['id', 'email', 'username', 'password', 'credits', 'isPremium', 'isVerified'];

  for (const field of forbiddenFields) {
    if (field in updatedFields) {
      delete updatedFields[field];
    }
  }

  // Préparer les données à mettre à jour
  const dataToUpdate = {};

  // Nickname avec validation
  if (updatedFields.nickname !== undefined) {
    validateNickname(updatedFields.nickname);
    dataToUpdate.nickname = updatedFields.nickname.trim();
  }

  // Bio
  if (updatedFields.bio !== undefined) {
    if (updatedFields.bio.length > 500) {
      throw new AppError('La bio ne peut pas dépasser 500 caractères', 400);
    }
    dataToUpdate.bio = updatedFields.bio.trim();
  }

  // Préférences (merge avec les existantes)
  if (updatedFields.preferences) {
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true }
    });
    
    dataToUpdate.preferences = {
      ...currentUser.preferences,
      ...updatedFields.preferences
    };
  }

  // Localisation
  if (updatedFields.latitude !== undefined && updatedFields.longitude !== undefined) {
    dataToUpdate.latitude = updatedFields.latitude;
    dataToUpdate.longitude = updatedFields.longitude;
  }

  if (updatedFields.city !== undefined) {
    dataToUpdate.city = updatedFields.city;
  }

  if (updatedFields.country !== undefined) {
    dataToUpdate.country = updatedFields.country;
  }

  // Rayon de recherche
  if (updatedFields.searchRadius !== undefined) {
    if (updatedFields.searchRadius < 1 || updatedFields.searchRadius > 500) {
      throw new AppError('Le rayon de recherche doit être entre 1 et 500 km', 400);
    }
    dataToUpdate.searchRadius = updatedFields.searchRadius;
  }

  // Ne JAMAIS permettre la modification de ces champs
  delete updatedFields.username;
  delete updatedFields.email;
  delete updatedFields.password;
  delete updatedFields.id;
  delete updatedFields.credits;
  delete updatedFields.isPremium;
  delete updatedFields.isVerified;

  const user = await prisma.user.update({
    where: { id: userId },
    data: dataToUpdate,
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      username: true,
      nickname: true,
      bio: true,
      photoUrl: true,
      preferences: true,
      searchRadius: true,
      latitude: true,
      longitude: true,
      city: true,
      country: true
    }
  });

  logger.info('user.service - Profil MAJ effectué', { userId });

  return user;
};

// ========== MISE À JOUR DU NICKNAME SEUL ==========

const updateNickname = async (userId, nickname) => {
  console.log('[SERVICE updateNickname] Params:', { userId, nickname });
  
  if (!userId) {
    throw new AppError('userId manquant', 400);
  }
  
  if (!nickname) {
    throw new AppError('nickname manquant', 400);
  }
  
  // Nettoyer et valider
  const cleanedNickname = nickname.trim();
  
  try {
    validateNickname(cleanedNickname);
  } catch (error) {
    console.error('[SERVICE updateNickname] Erreur validation:', error);
    throw error;
  }
  
  try {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { nickname: cleanedNickname },
      select: {
        id: true,
        username: true,
        nickname: true,
        firstName: true,
        lastName: true
      }
    });
    
    console.log('[SERVICE updateNickname] Succès:', updatedUser);
    return updatedUser;
    
  } catch (error) {
    console.error('[SERVICE updateNickname] Erreur Prisma:', error);
    if (error.code === 'P2025') {
      throw new AppError('Utilisateur non trouvé', 404);
    }
    throw error;
  }
};


// ========== LOCALISATION ==========

const updateLocation = async (userId, latitude, longitude) => {
  logger.info('user.service - MAJ localisation', { userId, latitude, longitude });

  if (!latitude || !longitude) {
    throw new AppError('Coordonnées invalides', 400);
  }

  // Valider les coordonnées
  if (latitude < -90 || latitude > 90) {
    throw new AppError('Latitude invalide', 400);
  }
  if (longitude < -180 || longitude > 180) {
    throw new AppError('Longitude invalide', 400);
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      latitude,
      longitude,
      // Optionnel : récupérer ville/pays via une API de géocodage
    },
    select: {
      id: true,
      latitude: true,
      longitude: true,
      city: true,
      country: true
    }
  });

  logger.info('user.service - Localisation MAJ', { userId });

  return updatedUser;
};

// ========== STATISTIQUES ==========

const getUserStats = async (userId) => {
  logger.info('user.service - Récupération stats', { userId });

  // Nombre de likes reçus
  const likesReceived = await prisma.like.count({
    where: { toUserId: userId }
  });

  // Nombre de matches
  const matches = await prisma.match.count({
    where: {
      isActive: true,
      OR: [
        { user1Id: userId },
        { user2Id: userId }
      ]
    }
  });

  // Nombre de vues de profil (derniers 30 jours)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const profileViews = await prisma.profileView.count({
    where: {
      profileId: userId,
      viewedAt: { gte: thirtyDaysAgo }
    }
  });

  return {
    likesReceived,
    matches,
    profileViews
  };
};

// ========== ACTIVITÉ ==========

const updateLastSeen = async (userId) => {
  await prisma.user.update({
    where: { id: userId },
    data: { lastSeen: new Date() }
  });
};

// ========== RECHERCHE D'UTILISATEUR ==========

const findUserByUsername = async (username) => {
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      nickname: true,
      firstName: true,
      photoUrl: true,
      isActive: true
    }
  });

  if (!user || !user.isActive) {
    throw new AppError('Utilisateur non trouvé', 404);
  }

  return user;
};

// ========== VÉRIFICATION ==========

const checkNicknameAvailability = async (nickname, excludeUserId = null) => {
  // Cette fonction peut être utilisée si vous voulez vérifier
  // qu'un nickname n'est pas déjà trop utilisé (optionnel)
  const whereClause = {
    nickname: {
      equals: nickname,
      mode: 'insensitive'
    }
  };

  if (excludeUserId) {
    whereClause.NOT = { id: excludeUserId };
  }

  const count = await prisma.user.count({ where: whereClause });

  return count === 0;
};

module.exports = {
  getUserProfile,
  updateUserProfile,
  updateNickname,
  updateLocation,
  getUserStats,
  updateLastSeen,
  findUserByUsername,
  validateNickname,
  checkNicknameAvailability
};