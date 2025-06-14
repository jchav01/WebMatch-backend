// auth.service.js mis à jour
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');
const crypto = require('crypto');

const prisma = new PrismaClient();

// Générateur d'username unique
const generateUniqueUsername = async () => {
  const maxAttempts = 10;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Format: user_XXXXXX (6 caractères aléatoires)
    const randomString = crypto.randomBytes(3).toString('hex');
    const username = `user_${randomString}`;
    
    // Vérifier l'unicité
    const existingUser = await prisma.user.findUnique({
      where: { username }
    });
    
    if (!existingUser) {
      return username;
    }
  }
  
  // Si on arrive ici, utiliser timestamp + random pour garantir l'unicité
  const timestamp = Date.now().toString(36);
  const randomString = crypto.randomBytes(2).toString('hex');
  return `user_${timestamp}_${randomString}`;
};

// Fonction pour générer un nickname initial
const generateInitialNickname = (firstName, lastName) => {
  // Option 1: Prénom + initiale du nom
  const initial = lastName ? lastName.charAt(0).toUpperCase() : '';
  return `${firstName}${initial}`.trim();
  
  // Option 2: Juste le prénom
  // return firstName;
};

const signup = async (userData) => {
  const { email, password, firstName, lastName, dateOfBirth, gender } = userData;

  logger.info('auth.service - Tentative signup', { email });

  // Validations
  if (!email || !password || !firstName || !lastName || !gender || !dateOfBirth) {
    logger.warn('auth.service - Données requises manquantes', { email });
    throw new AppError('Données requises manquantes.', 400);
  }

  // Validation email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new AppError('Format email invalide', 400);
  }

  // Validation mot de passe
  if (password.length < 8) {
    throw new AppError('Le mot de passe doit contenir au moins 8 caractères', 400);
  }

  // Validation date de naissance
  if (isNaN(Date.parse(dateOfBirth))) {
    logger.warn('auth.service - Date de naissance invalide', { email });
    throw new AppError('Date de naissance invalide.', 400);
  }

  const age = calculateAgeFromDate(new Date(dateOfBirth));
  if (age < 18) {
    logger.warn('auth.service - Âge insuffisant', { email });
    throw new AppError('Vous devez avoir au moins 18 ans pour vous inscrire.', 400);
  }

  // Vérification email existant
  const existingEmail = await prisma.user.findUnique({ where: { email } });
  if (existingEmail) {
    logger.warn('auth.service - Email déjà utilisé', { email });
    throw new AppError('Cet email est déjà utilisé', 400);
  }

  // Générer username unique
  const generatedUsername = await generateUniqueUsername();
  
  // Générer nickname initial (peut être modifié par l'utilisateur plus tard)
  const initialNickname = generateInitialNickname(firstName, lastName);

  const hashedPassword = await bcrypt.hash(password, 12);

  const defaultPreferences = {
    showProfile: true,
    allowInvites: true,
    autoWebcam: false,
    genderPreference: { male: true, female: true },
    webcamRequired: true,
    autoAcceptFriends: false,
    friendsOnlyChat: false,
    notifyMatch: true,
    notifyMessages: true,
    notifyVisualOnly: false,
    ageRange: [18, 70],
    distanceKm: 50,
  };

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      firstName,
      lastName,
      dateOfBirth: new Date(dateOfBirth),
      gender,
      username: generatedUsername,
      nickname: initialNickname,
      preferences: defaultPreferences,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      username: true,
      nickname: true,
      dateOfBirth: true,
      gender: true,
      photoUrl: true,
      preferences: true,
    }
  });

  const token = jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  logger.info('auth.service - Signup réussi', { 
    userId: user.id, 
    username: user.username,
    nickname: user.nickname 
  });

  return { user, token };
};

const login = async (email, password) => {
  logger.info('auth.service - Tentative login', { email });

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      password: true,
      firstName: true,
      lastName: true,
      username: true,
      nickname: true,
      isActive: true
    }
  });

  if (!user) {
    logger.warn('auth.service - Email non trouvé', { email });
    throw new AppError('Identifiants invalides', 401);
  }

  if (!user.isActive) {
    logger.warn('auth.service - Compte désactivé', { userId: user.id });
    throw new AppError('Compte désactivé', 403);
  }

  const passwordMatch = await bcrypt.compare(password, user.password);

  if (!passwordMatch) {
    logger.warn('auth.service - Mot de passe incorrect', { userId: user.id });
    throw new AppError('Identifiants invalides', 401);
  }

  const token = jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  const { password: _, ...userWithoutPassword } = user;

  // Mettre à jour lastSeen
  await prisma.user.update({
    where: { id: user.id },
    data: { lastSeen: new Date() }
  });

  logger.info('auth.service - Login réussi', { userId: user.id });

  return { user: userWithoutPassword, token };
};

const calculateAgeFromDate = (birthDate) => {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

module.exports = { signup, login };