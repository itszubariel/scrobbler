# Changelog

All notable changes to scrobbler are documented here.

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
