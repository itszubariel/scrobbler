# Changelog

All notable changes to scrobbler are documented here.

---

## [1.1.0] — 2026-04-18

### New Commands
- `/info artist` — Artist info with bio, listeners, tags, similar artists, and personal playcount
- `/info album` — Album info with track list, duration, release year, and personal playcount
- `/info track` — Track info with duration, tags, wiki, loved status, and personal playcount
- `/info genre` — Genre info with reach, taggings, wiki, and top artists
- `/taste user` — User's top 50 genres (refactored from `/taste`)
- `/taste server` — Server's aggregated top 50 genres
- `/discovery` — Underground vs mainstream score based on top 100 artists
- `/personality` — Music personality type with 5 dimension bars (loyalty, diversity, mainstream, intensity, nostalgia)
- `/streak` — Top listening streaks over the last 90 days across artists, tracks, and albums
- `/wrapped` — Personalized Scrobbler Wrapped with 5 navigable canvas cards, cached via Supabase Storage

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

## [1.0.0] — 2026-04-16

### Initial Release

#### Commands
- `/link` — Last.fm OAuth flow with background polling (no redirect needed)
- `/unlink` — Disconnect Last.fm account
- `/profile` — Music profile with AI-generated bio via Groq
- `/np` — Now playing with dynamic layout, genre tags, release year, play count
- `/recent` — Paginated recent tracks with hyperlinked song names
- `/taste` — Genre breakdown bar chart (up to 50 genres, paginated)
- `/compat` — Music compatibility score across artists, tracks, albums, and genres with canvas bar chart
- `/chart artists` — Top artists grid chart (3×3 / 4×4 / 5×5) via Deezer images
- `/chart albums` — Top albums grid chart using Last.fm album art
- `/chart tracks` — Top tracks grid chart via Deezer
- `/chart server` — Server-wide aggregated chart for artists, albums, or tracks
- `/stats scrobbles` — Server scrobble leaderboard with canvas image and pagination
- `/stats artists` — Unique artist count leaderboard
- `/stats albums` — Unique album count leaderboard
- `/stats genres` — Unique genre diversity leaderboard
- `/help` — Interactive help with select menus per section

#### Infrastructure
- PostgreSQL via Prisma with `User`, `Server`, `ServerMember`, `Play`, and `PendingLink` models
- Components V2 embeds throughout
- Canvas-generated images for stats, taste, compat, and chart commands
- Custom emoji support via `E` object
- Guild commands in development, global commands in production
