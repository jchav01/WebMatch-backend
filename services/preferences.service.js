const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getUserPreferences = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  });
  return user?.preferences || {};
};

const updateUserPreferences = async (userId, preferences) => {
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      preferences, // tout est dans ce champ JSON
      searchRadius: preferences.distanceKm,
      minAgePreference: preferences.ageRange?.[0],
      maxAgePreference: preferences.ageRange?.[1],
    },
  });
  return updatedUser.preferences;
};

module.exports = {
  getUserPreferences,
  updateUserPreferences,
};
