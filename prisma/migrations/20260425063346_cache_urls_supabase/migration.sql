/*
  Warnings:

  - You are about to drop the column `members` on the `StatsAlbumsCache` table. All the data in the column will be lost.
  - You are about to drop the column `members` on the `StatsArtistsCache` table. All the data in the column will be lost.
  - You are about to drop the column `members` on the `StatsGenresCache` table. All the data in the column will be lost.
  - You are about to drop the column `members` on the `StatsScrobblesCache` table. All the data in the column will be lost.
  - You are about to drop the column `genres` on the `TasteServerCache` table. All the data in the column will be lost.
  - You are about to drop the column `genres` on the `TasteUserCache` table. All the data in the column will be lost.
  - You are about to drop the column `members` on the `WkCache` table. All the data in the column will be lost.
  - Added the required column `memberCount` to the `StatsAlbumsCache` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalPages` to the `StatsAlbumsCache` table without a default value. This is not possible if the table is not empty.
  - Added the required column `memberCount` to the `StatsArtistsCache` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalPages` to the `StatsArtistsCache` table without a default value. This is not possible if the table is not empty.
  - Added the required column `memberCount` to the `StatsGenresCache` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalPages` to the `StatsGenresCache` table without a default value. This is not possible if the table is not empty.
  - Added the required column `footerText` to the `StatsScrobblesCache` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalPages` to the `StatsScrobblesCache` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalPages` to the `TasteServerCache` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalPages` to the `TasteUserCache` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalListeners` to the `WkCache` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalPages` to the `WkCache` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "StatsAlbumsCache" DROP COLUMN "members",
ADD COLUMN     "memberCount" INTEGER NOT NULL,
ADD COLUMN     "totalPages" INTEGER NOT NULL,
ADD COLUMN     "urls" TEXT[];

-- AlterTable
ALTER TABLE "StatsArtistsCache" DROP COLUMN "members",
ADD COLUMN     "memberCount" INTEGER NOT NULL,
ADD COLUMN     "totalPages" INTEGER NOT NULL,
ADD COLUMN     "urls" TEXT[];

-- AlterTable
ALTER TABLE "StatsGenresCache" DROP COLUMN "members",
ADD COLUMN     "memberCount" INTEGER NOT NULL,
ADD COLUMN     "totalPages" INTEGER NOT NULL,
ADD COLUMN     "urls" TEXT[];

-- AlterTable
ALTER TABLE "StatsScrobblesCache" DROP COLUMN "members",
ADD COLUMN     "footerText" TEXT NOT NULL,
ADD COLUMN     "totalPages" INTEGER NOT NULL,
ADD COLUMN     "urls" TEXT[];

-- AlterTable
ALTER TABLE "TasteServerCache" DROP COLUMN "genres",
ADD COLUMN     "totalPages" INTEGER NOT NULL,
ADD COLUMN     "urls" TEXT[];

-- AlterTable
ALTER TABLE "TasteUserCache" DROP COLUMN "genres",
ADD COLUMN     "totalPages" INTEGER NOT NULL,
ADD COLUMN     "urls" TEXT[];

-- AlterTable
ALTER TABLE "WkCache" DROP COLUMN "members",
ADD COLUMN     "totalListeners" INTEGER NOT NULL,
ADD COLUMN     "totalPages" INTEGER NOT NULL,
ADD COLUMN     "urls" TEXT[];
