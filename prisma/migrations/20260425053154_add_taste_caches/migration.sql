-- CreateTable
CREATE TABLE "TasteUserCache" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "genres" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TasteUserCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TasteServerCache" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "genres" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TasteServerCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TasteUserCache_discordId_period_key" ON "TasteUserCache"("discordId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "TasteServerCache_guildId_period_key" ON "TasteServerCache"("guildId", "period");
