const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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

const updateUsersPreferences = async () => {
  const usersToUpdate = await prisma.user.findMany({
    where: {
      preferences: null,
    },
  });

  for (const user of usersToUpdate) {
    await prisma.user.update({
      where: { id: user.id },
      data: { preferences: defaultPreferences },
    });
    console.log(`Updated preferences for user ${user.id}`);
  }

  console.log('Done updating users preferences.');
};

updateUsersPreferences()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
