-- CreateTable
CREATE TABLE "StatsScrobblesCache" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "members" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatsScrobblesCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StatsScrobblesCache_guildId_key" ON "StatsScrobblesCache"("guildId");
