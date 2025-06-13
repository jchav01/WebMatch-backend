import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixGenderPreference() {
  const users = await prisma.user.findMany({
    where: {
      // on force les cas où c'est un string
      OR: [
        { genderPreference: 'all' },
        { genderPreference: 'male' },
        { genderPreference: 'female' },
        { genderPreference: 'other' },
      ],
    },
  });

  for (const user of users) {
    let newPref = { male: true, female: true };

    if (user.genderPreference === 'male') {
      newPref = { male: true, female: false };
    } else if (user.genderPreference === 'female') {
      newPref = { male: false, female: true };
    } else if (user.genderPreference === 'all' || user.genderPreference === 'other' || user.genderPreference === null) {
      newPref = { male: true, female: true };
    } else {
      console.warn(`User ${user.id} → unexpected value "${user.genderPreference}", applying fallback.`);
    }

    console.log(`User ${user.id}: "${user.genderPreference}" →`, newPref);

    await prisma.user.update({
        where: { id: user.id },
        data: {
            genderPreference: {
            set: newPref,
            },
        },
    });

    console.log(`→ User ${user.id} updated.`);
  }

  console.log('Fix completed.');
  await prisma.$disconnect();
}

fixGenderPreference().catch((e) => {
  console.error(e);
  process.exit(1);
});
