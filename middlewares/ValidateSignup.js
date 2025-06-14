// middlewares/ValidateSignup.js

const AppError = require('../utils/AppError');

const validateSignup = (req, res, next) => {
  const { email, password, firstName, lastName, username, gender, dateOfBirth } = req.body;

  if (!email || !email.includes('@')) {
    throw new AppError('Email invalide.', 400);
  }

  if (!password || password.length < 6) {
    throw new AppError('Le mot de passe doit contenir au moins 6 caractères.', 400);
  }

  if (!firstName || firstName.trim() === '') {
    throw new AppError('Le prénom est requis.', 400);
  }

  if (!lastName || lastName.trim() === '') {
    throw new AppError('Le nom est requis.', 400);
  }


  if (!gender || (gender !== 'MALE' && gender !== 'FEMALE' && gender !== 'OTHER')) {
    throw new AppError('Le genre est invalide.', 400);
  }

  if (!dateOfBirth || isNaN(Date.parse(dateOfBirth))) {
    throw new AppError('Date de naissance invalide.', 400);
  }

  // Âge minimum (optionnel)
  const age = calculateAgeFromDate(new Date(dateOfBirth));
  if (age < 18) {
    throw new AppError('Vous devez avoir au moins 18 ans pour vous inscrire.', 400);
  }

  next();
};

// Helper pour âge
const calculateAgeFromDate = (birthDate) => {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

module.exports = validateSignup;
