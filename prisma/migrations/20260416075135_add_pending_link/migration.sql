-- CreateTable
CREATE TABLE "PendingLink" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingLink_discordId_key" ON "PendingLink"("discordId");
