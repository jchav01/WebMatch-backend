-- AlterTable
ALTER TABLE "User" ADD COLUMN     "genderPreference" TEXT DEFAULT 'all',
ADD COLUMN     "maxAgePreference" INTEGER DEFAULT 70,
ADD COLUMN     "minAgePreference" INTEGER DEFAULT 18;
