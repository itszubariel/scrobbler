-- CreateTable
CREATE TABLE "Play" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "trackName" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "albumName" TEXT,
    "playedAt" TIMESTAMP(3) NOT NULL,
    "mbid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Play_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Play_userId_idx" ON "Play"("userId");

-- CreateIndex
CREATE INDEX "Play_serverId_idx" ON "Play"("serverId");

-- CreateIndex
CREATE INDEX "Play_playedAt_idx" ON "Play"("playedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Play_userId_playedAt_key" ON "Play"("userId", "playedAt");

-- AddForeignKey
ALTER TABLE "Play" ADD CONSTRAINT "Play_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Play" ADD CONSTRAINT "Play_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
