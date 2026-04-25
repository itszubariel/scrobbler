-- CreateTable
CREATE TABLE "StatsArtistsCache" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "members" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatsArtistsCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatsAlbumsCache" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "members" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatsAlbumsCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatsGenresCache" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "members" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatsGenresCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WkCache" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "members" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WkCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StatsArtistsCache_guildId_key" ON "StatsArtistsCache"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "StatsAlbumsCache_guildId_key" ON "StatsAlbumsCache"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "StatsGenresCache_guildId_key" ON "StatsGenresCache"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "WkCache_guildId_key_key" ON "WkCache"("guildId", "key");
