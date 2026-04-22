# scrobbler

A Discord bot that brings your Last.fm listening history to life. Track what you're playing, compare taste with friends, generate charts, and explore your music identity, all inside Discord.

![scrobbler banner](assests/images/scrobbler_banner.png)

---

## What is scrobbler?

scrobbler connects your Last.fm account to Discord. Once linked, you can see what you're listening to, compare music taste with friends, generate visual charts of your top artists and albums, and compete on server leaderboards, all without leaving Discord.

---

## Commands

| Command | Description |
|---|---|
| `/link` | Connect your Last.fm account |
| `/unlink` | Disconnect your Last.fm account |
| `/profile` | Your music profile with an AI-generated bio |
| `/np` | See what you're scrobbling right now |
| `/recent` | Your recently scrobbled tracks |
| `/chart artists` | Grid chart of your top artists |
| `/chart albums` | Grid chart of your top albums |
| `/chart tracks` | Grid chart of your top tracks |
| `/chart server` | Server-wide top artists, albums or tracks |
| `/info artist` | Detailed info about an artist |
| `/info album` | Detailed info about an album |
| `/info track` | Detailed info about a track |
| `/info genre` | Detailed info about a genre |
| `/taste user` | Your top 50 genres |
| `/taste server` | This server's top genres |
| `/compat` | See how your taste compares to another user |
| `/discovery` | See how underground or mainstream your taste is |
| `/personality` | Discover your music personality type |
| `/streak` | Your top listening streaks over the last 90 days |
| `/wrapped` | Your personalized Scrobbler Wrapped |
| `/wk artist` | Who has listened to this artist the most |
| `/wk album` | Who has listened to this album the most |
| `/wk track` | Who has listened to this track the most |
| `/wk genre` | Who listens to this genre the most |
| `/stats scrobbles` | Who has scrobbled the most in this server |
| `/stats artists` | Who has listened to the most unique artists |
| `/stats albums` | Who has listened to the most unique albums |
| `/stats genres` | Who has the most diverse taste |

---

## Add to your server

> [Invite scrobbler now](https://discord.com/oauth2/authorize?client_id=1493297305275863120&permissions=2147600384&integration_type=0&scope=bot+applications.commands)

---

## Source Availability

This repository is public so all users can verify what the bot does and confirm it is safe to use. The source code is **not open source** you may not copy, self-host, or redistribute it. See [LICENSE.md](LICENSE.md) for details.

---

## Tech Stack

- [discord.js](https://discord.js.org) v14 with Components V2
- [Prisma](https://prisma.io) with PostgreSQL (Supabase)
- [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) for image generation
- [Groq](https://groq.com) (llama-3.1-8b-instant) for AI bios
- [Last.fm API](https://www.last.fm/api) for music data
- [Deezer API](https://developers.deezer.com) for artist artwork
- [iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI) for album/track artwork
- [Supabase Storage](https://supabase.com/storage) for wrapped image caching
