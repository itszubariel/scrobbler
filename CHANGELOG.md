# Changelog

All notable changes to scrobbler are documented here.

## [1.4.1] : 2026-07-17

### New Commands
- `/loved` : View your paginated list of loved tracks from Last.fm, complete with cached pages and Discord native timestamps

---

## [1.4.0] : 2026-07-06

### New Commands
- `/era` : Your current music era based on dominant genre, with top 3 artists and most played track for the period. Supports all time periods, defaults to last month
- `/milestone` : Canvas progress card showing how close you are to the next milestone across scrobbles, artists, albums, and tracks
- `/overlap` : Find music shared across you and up to 9 other users, shows artists, tracks, albums, and genres every single person has in common
- `/bingo` : 3x3 music taste bingo card with 9 challenges checked against your real listening history. Each cell shows your actual stat so you can see how close you are

---

## [1.3.1] : 2026-07-06

### New Commands
- `/timeline artists` : Line chart of unique artists discovered per month
- `/timeline albums` : Line chart of unique albums listened to per month
- `/timeline tracks` : Line chart of total scrobbles per month
- `/timeline genres` : Multi-line chart showing your top 3 genre trends over time
- `/timeline server` : Server-wide combined scrobble trend per month

### Improvements
- All timeline commands support a `months` option (3, 6, or 12 months) and an optional `user` parameter
- Timeline images cached for 60 minutes via Supabase Storage (`timeline-cache` bucket)

### Internal
- Built custom line chart canvas renderer with smooth bezier curves, area fill, grid lines, and multi-series legend support

---

## [1.3.0] : 2026-05-06

### New Commands
- `/rec artists` : Get personalized artist recommendations based on your listening history
- `/rec tracks` : Get personalized track recommendations based on your listening history
- `/rec albums` : Get personalized album recommendations based on your listening history

### Improvements
- All recommendation commands use Groq AI (llama-3.1-8b-instant) with JSON mode for reliable, contextual descriptions
- Recommendations are cached for 6 hours per user per time period
- Each recommendation includes a personalized reason referencing your actual top artists/tracks
- Recommendations support all time periods: last 7 days, last month, 3 months, 6 months, last year, and all time
- Recommendations can be generated for other users by using the optional `user` parameter

### Internal
- Implemented generic caching system with `Cache` model replacing all specific cache tables
- Removed deprecated cache models: `WrappedCache`, `RecentCache`, `TasteUserCache`, `TasteServerCache`, `StatsScrobblesCache`, `StatsArtistsCache`, `StatsAlbumsCache`, `StatsGenresCache`, `WkCache`
- All commands now use unified `getCache()` and `setCache()` utilities from `cache.ts`
- Supabase Storage buckets continue to store images, Cache table stores URLs and metadata as JSON
- Added cache invalidation on `/link` and `/unlink` to clear stale user data

---

## [1.2.1] : 2026-05-05

### Improvements
- Status page degraded threshold changed from "any service degraded" to 
  "majority of services degraded", minor issues no longer mark the 
  entire status page as degraded
- Database health check timeout increased from 1.2s to 2.0s to better 
  reflect acceptable response times and reduce false degraded states

### Internal
- Codebase-wide formatting pass across 65 files (no logic changes)

---

## [1.2.0] : 2026-04-25

### Fixes & Improvements
- `/stats`, `/wk`, `/taste`, and `/recent` now cache all pages upfront on first run, page navigation is instant with no API calls on button clicks
- Canvas images are pre-rendered and stored in Supabase Storage (`stats-cache`, `wk-cache`, `taste-cache` buckets), same approach as `/wrapped`
- `/stats artists`, `/stats albums`, `/stats genres` now show all linked members with full pagination (was incorrectly capped at top 10)
- `/stats` and `/wk` commands no longer require a minimum of 2 linked members, works with any number
- `/taste server` footer now shows member count (e.g. `Page 1 of 5 • 12 members • All time`)
- Page footer shows `Page 1` instead of `Page 1 of 1` when there's only a single page
- All command references in bot messages now use proper Discord command mentions instead of plain text (e.g. `/link`)
- Added `RecentCache`, `TasteUserCache`, `TasteServerCache`, `StatsScrobblesCache`, `StatsArtistsCache`, `StatsAlbumsCache`, `StatsGenresCache`, and `WkCache` Prisma models

---

## [1.1.0] : 2026-04-18

### New Commands
- `/info artist` : Artist info with bio, listeners, tags, similar artists, and personal playcount
- `/info album` : Album info with track list, duration, release year, and personal playcount
- `/info track` : Track info with duration, tags, wiki, loved status, and personal playcount
- `/info genre` : Genre info with reach, taggings, wiki, and top artists
- `/taste user` : User's top 50 genres (refactored from `/taste`)
- `/taste server` : Server's aggregated top 50 genres
- `/discovery` : Underground vs mainstream score based on top 100 artists
- `/personality` : Music personality type with 5 dimension bars (loyalty, diversity, mainstream, intensity, nostalgia)
- `/streak` : Top listening streaks over the last 90 days across artists, tracks, and albums
- `/wrapped` : Personalized Scrobbler Wrapped with 5 navigable canvas cards, cached via Supabase Storage

### Improvements
- Autocomplete for `/wk` and `/info` now searches Last.fm globally when typing, shows personal top 20 when empty
- Image fetching switched to iTunes API for tracks/albums (better K-pop coverage), Deezer for artists with exact name matching
- `/stats` genre/artist/album leaderboards fixed to include all linked members (was incorrectly slicing to 10)
- `/chart server tracks` now keys by `track|||artist` to prevent wrong covers for same-named tracks by different artists
- All chart commands use consistent image sources: Deezer `picture_xl` for artists, iTunes for albums/tracks with Last.fm fallback

### Infrastructure
- Added `WrappedCache` Prisma model for Supabase Storage URL caching
- Added `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` environment variables

---

## [1.0.0] : 2026-04-16

### Initial Release

#### Commands
- `/link` : Last.fm OAuth flow with background polling (no redirect needed)
- `/unlink` : Disconnect Last.fm account
- `/profile` : Music profile with AI-generated bio via Groq
- `/np` : Now playing with dynamic layout, genre tags, release year, play count
- `/recent` : Paginated recent tracks with hyperlinked song names
- `/taste` : Genre breakdown bar chart (up to 50 genres, paginated)
- `/compat` : Music compatibility score across artists, tracks, albums, and genres with canvas bar chart
- `/chart artists` : Top artists grid chart (3x3 / 4x4 / 5x5) via Deezer images
- `/chart albums` : Top albums grid chart using Last.fm album art
- `/chart tracks` : Top tracks grid chart via Deezer
- `/chart server` : Server-wide aggregated chart for artists, albums, or tracks
- `/stats scrobbles` : Server scrobble leaderboard with canvas image and pagination
- `/stats artists` : Unique artist count leaderboard
- `/stats albums` : Unique album count leaderboard
- `/stats genres` : Unique genre diversity leaderboard
- `/help` : Interactive help with select menus per section

#### Infrastructure
- PostgreSQL via Prisma with `User`, `Server`, `ServerMember`, `Play`, and `PendingLink` models
- Components V2 embeds throughout
- Canvas-generated images for stats, taste, compat, and chart commands
- Custom emoji support via `E` object
- Guild commands in development, global commands in production
