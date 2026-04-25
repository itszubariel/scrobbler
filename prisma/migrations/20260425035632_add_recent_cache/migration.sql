-- CreateTable
CREATE TABLE "RecentCache" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "tracks" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecentCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecentCache_discordId_key" ON "RecentCache"("discordId");
