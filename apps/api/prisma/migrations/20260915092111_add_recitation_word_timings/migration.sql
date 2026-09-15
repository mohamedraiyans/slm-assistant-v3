-- CreateEnum
CREATE TYPE "RecitationWordMatch" AS ENUM ('EXACT', 'FUZZY', 'SUBSTITUTED', 'MISSING');

-- AlterTable
ALTER TABLE "RecitationReference" ADD COLUMN     "durationSec" DOUBLE PRECISION,
ADD COLUMN     "matchRate" DOUBLE PRECISION,
ADD COLUMN     "modelId" TEXT,
ADD COLUMN     "modelRevision" TEXT,
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "processingError" TEXT;

-- CreateTable
CREATE TABLE "RecitationWord" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "ayah" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "match" "RecitationWordMatch" NOT NULL,
    "estimated" BOOLEAN NOT NULL,

    CONSTRAINT "RecitationWord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecitationWord_referenceId_ayah_position_key" ON "RecitationWord"("referenceId", "ayah", "position");

-- AddForeignKey
ALTER TABLE "RecitationWord" ADD CONSTRAINT "RecitationWord_referenceId_fkey" FOREIGN KEY ("referenceId") REFERENCES "RecitationReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;
