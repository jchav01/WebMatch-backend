const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const logger = require('../config/logger');
const AppError = require('../utils/AppError');

const prisma = new PrismaClient();

const signup = async (userData) => {
  const { email, password, firstName, lastName, dateOfBirth, gender } = userData;

  logger.info('auth.service - Tentative signup', { email });

  if (!email || !password || !firstName || !lastName || !gender || !dateOfBirth) {
    logger.warn('auth.service - Données requises manquantes', { email });
    throw new AppError('Données requises manquantes.', 400);
  }

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

  // Générer le username automatiquement (par défaut → prénom + suffixe random pour éviter les doublons)
  const generatedUsername = firstName;

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
      preferences: defaultPreferences,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      username: true,
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

  logger.info('auth.service - Signup réussi', { userId: user.id });

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
      username: true
    }
  });

  if (!user) {
    logger.warn('auth.service - Email non trouvé', { email });
    throw new AppError('Identifiants invalides', 401);
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

// Générer un username unique
const generateUniqueUsername = async (firstName) => {
  let baseUsername = firstName.toLowerCase().replace(/\s+/g, '');
  let username = baseUsername;
  let counter = 0;

  while (true) {
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (!existingUser) {
      return username;
    }
    counter++;
    username = `${baseUsername}${counter}`;
  }
};

module.exports = { signup, login };
