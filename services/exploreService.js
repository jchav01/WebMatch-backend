const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getRandomUser = async (currentUserId) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        id: { not: currentUserId },
        photoUrl: { not: null },
        // tu peux ici ajouter + tard : préférences genre, âge...
      },
      select: {
        id: true,
        username: true,
        dateOfBirth: true,
        photoUrl: true,
        bio: true,
        gender: true,
      },
    });

    if (users.length === 0) {
      console.log('No users found matching criteria.');
      return null;
    }
    const randomIndex = Math.floor(Math.random() * users.length);
    const selectedUser = users[randomIndex];

    return selectedUser;
  } catch (err) {
    console.error('Erreur dans getRandomUser:', err);
    throw err; // important : on relance l'erreur pour que la route renvoie bien 500
  }
};

module.exports = {
  getRandomUser,
};
