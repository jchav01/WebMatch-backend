/*
  Warnings:

  - The values [MATCH] on the enum `VideoSessionType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `action` on the `Report` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `Report` table. All the data in the column will be lost.
  - The `reviewedBy` column on the `Report` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `VideoSession` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `identitiesRevealed` on the `VideoSession` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `VideoSession` table. All the data in the column will be lost.
  - The `id` column on the `VideoSession` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `VideoSessionMessage` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `VideoSessionMessage` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `updatedAt` to the `FriendRequest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Message` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `reason` on the `Report` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Made the column `user1Id` on table `VideoSession` required. This step will fail if there are existing NULL values in that column.
  - Made the column `user2Id` on table `VideoSession` required. This step will fail if there are existing NULL values in that column.
  - Changed the type of `videoSessionId` on the `VideoSessionMessage` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Made the column `senderId` on table `VideoSessionMessage` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'LOCATION';

-- AlterEnum
BEGIN;
CREATE TYPE "VideoSessionType_new" AS ENUM ('RANDOM', 'FRIEND', 'SCHEDULED');
ALTER TABLE "VideoSession" ALTER COLUMN "sessionType" DROP DEFAULT;
ALTER TABLE "VideoSession" ALTER COLUMN "sessionType" TYPE "VideoSessionType_new" USING ("sessionType"::text::"VideoSessionType_new");
ALTER TYPE "VideoSessionType" RENAME TO "VideoSessionType_old";
ALTER TYPE "VideoSessionType_new" RENAME TO "VideoSessionType";
DROP TYPE "VideoSessionType_old";
ALTER TABLE "VideoSession" ALTER COLUMN "sessionType" SET DEFAULT 'RANDOM';
COMMIT;

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_user1Id_fkey";

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_user2Id_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_receiverId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_senderId_fkey";

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_reportedId_fkey";

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_reporterId_fkey";

-- DropForeignKey
ALTER TABLE "VideoSession" DROP CONSTRAINT "VideoSession_user1Id_fkey";

-- DropForeignKey
ALTER TABLE "VideoSession" DROP CONSTRAINT "VideoSession_user2Id_fkey";

-- DropForeignKey
ALTER TABLE "VideoSessionMessage" DROP CONSTRAINT "VideoSessionMessage_senderId_fkey";

-- DropForeignKey
ALTER TABLE "VideoSessionMessage" DROP CONSTRAINT "VideoSessionMessage_videoSessionId_fkey";

-- DropIndex
DROP INDEX "Message_receiverId_isRead_idx";

-- DropIndex
DROP INDEX "Report_reportedId_idx";

-- DropIndex
DROP INDEX "VideoSessionMessage_videoSessionId_createdAt_idx";

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "isArchived1" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isArchived2" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isMuted1" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isMuted2" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "FriendRequest" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Report" DROP COLUMN "action",
DROP COLUMN "description",
ADD COLUMN     "context" TEXT,
ADD COLUMN     "details" TEXT,
ADD COLUMN     "metadata" JSONB,
DROP COLUMN "reason",
ADD COLUMN     "reason" TEXT NOT NULL,
DROP COLUMN "reviewedBy",
ADD COLUMN     "reviewedBy" INTEGER;

-- AlterTable
ALTER TABLE "VideoSession" DROP CONSTRAINT "VideoSession_pkey",
DROP COLUMN "identitiesRevealed",
DROP COLUMN "updatedAt",
ADD COLUMN     "friendshipCreated" BOOLEAN NOT NULL DEFAULT false,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ALTER COLUMN "user1Id" SET NOT NULL,
ALTER COLUMN "user2Id" SET NOT NULL,
ADD CONSTRAINT "VideoSession_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "VideoSessionMessage" DROP CONSTRAINT "VideoSessionMessage_pkey",
ADD COLUMN     "messageType" "MessageType" NOT NULL DEFAULT 'TEXT',
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "videoSessionId",
ADD COLUMN     "videoSessionId" INTEGER NOT NULL,
ALTER COLUMN "senderId" SET NOT NULL,
ADD CONSTRAINT "VideoSessionMessage_pkey" PRIMARY KEY ("id");

-- DropEnum
DROP TYPE "ReportReason";

-- CreateTable
CREATE TABLE "MessageReaction" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoSessionMetric" (
    "id" SERIAL NOT NULL,
    "videoSessionId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "metricType" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoSessionMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageReaction_messageId_userId_emoji_key" ON "MessageReaction"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "VideoSessionMetric_videoSessionId_idx" ON "VideoSessionMetric"("videoSessionId");

-- CreateIndex
CREATE INDEX "VideoSessionMetric_userId_idx" ON "VideoSessionMetric"("userId");

-- CreateIndex
CREATE INDEX "FriendRequest_status_idx" ON "FriendRequest"("status");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "Message_receiverId_idx" ON "Message"("receiverId");

-- CreateIndex
CREATE INDEX "Message_isRead_idx" ON "Message"("isRead");

-- CreateIndex
CREATE INDEX "Report_createdAt_idx" ON "Report"("createdAt");

-- CreateIndex
CREATE INDEX "VideoSessionMessage_videoSessionId_idx" ON "VideoSessionMessage"("videoSessionId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_user1Id_fkey" FOREIGN KEY ("user1Id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_user2Id_fkey" FOREIGN KEY ("user2Id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoSession" ADD CONSTRAINT "VideoSession_user1Id_fkey" FOREIGN KEY ("user1Id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoSession" ADD CONSTRAINT "VideoSession_user2Id_fkey" FOREIGN KEY ("user2Id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoSessionMessage" ADD CONSTRAINT "VideoSessionMessage_videoSessionId_fkey" FOREIGN KEY ("videoSessionId") REFERENCES "VideoSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoSessionMessage" ADD CONSTRAINT "VideoSessionMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoSessionMetric" ADD CONSTRAINT "VideoSessionMetric_videoSessionId_fkey" FOREIGN KEY ("videoSessionId") REFERENCES "VideoSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoSessionMetric" ADD CONSTRAINT "VideoSessionMetric_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
