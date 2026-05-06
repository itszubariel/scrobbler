-- Drop old cache tables that have been replaced by the generic Cache table
DROP TABLE IF EXISTS "WrappedCache";
DROP TABLE IF EXISTS "RecentCache";
DROP TABLE IF EXISTS "TasteUserCache";
DROP TABLE IF EXISTS "TasteServerCache";
DROP TABLE IF EXISTS "StatsScrobblesCache";
DROP TABLE IF EXISTS "StatsArtistsCache";
DROP TABLE IF EXISTS "StatsAlbumsCache";
DROP TABLE IF EXISTS "StatsGenresCache";
DROP TABLE IF EXISTS "WkCache";
