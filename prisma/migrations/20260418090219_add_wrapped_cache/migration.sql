-- CreateTable
CREATE TABLE "WrappedCache" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "urls" TEXT[],
    "period" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WrappedCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WrappedCache_discordId_key" ON "WrappedCache"("discordId");
