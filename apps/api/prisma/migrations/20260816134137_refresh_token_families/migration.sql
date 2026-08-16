/*
  Warnings:

  - Added the required column `familyId` to the `refresh_tokens` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RefreshTokenRevocationReason" AS ENUM ('ROTATED', 'LOGOUT', 'REUSE_DETECTED', 'MEMBERSHIP_CHANGED');

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "familyId" UUID NOT NULL,
ADD COLUMN     "revokedReason" "RefreshTokenRevocationReason";

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");
