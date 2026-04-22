import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = join(__dirname, '../../assests/images/scrobbler_logo.png');

const BG = '#111111';
const BG_COVER = '#0d0d0d';
const TEXT_PRIMARY = '#ffffff';
const TEXT_SECONDARY = '#888888';
const TEXT_DIM = '#444444';
const BOX_BG = '#1a1a1a';
const ROW_BG_ALT = '#1e1e1e';
const W = 800;
const H = 480;

function baseCanvas(bg = BG) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // Subtle purple haze top-left (same as stats/taste)
  const hazeGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 220);
  hazeGrad.addColorStop(0, 'rgba(120, 60, 220, 0.12)');
  hazeGrad.addColorStop(0.5, 'rgba(80, 30, 160, 0.05)');
  hazeGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = hazeGrad;
  ctx.fillRect(0, 0, W, H);
  return { canvas, ctx };
}

// Draw circular logo at top right — vertically centered with the section label text
async function drawCardChrome(ctx: any, labelY = 30) {
  try {
    const logo = await loadImage(LOGO_PATH);
    const SIZE = 28;
    // Center logo vertically with the label (baseline - half cap height ≈ baseline - 8)
    const textCenterY = labelY - 8;
    const X = W - SIZE - 20;
    const Y = textCenterY - SIZE / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(X + SIZE / 2, Y + SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, X, Y, SIZE, SIZE);
    ctx.restore();
  } catch { /* skip if logo missing */ }
}

function tracked(text: string): string {
  return text.split('').join(' ');
}

function truncate(ctx: any, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (ctx.measureText(t + '…').width > maxWidth && t.length > 0) t = t.slice(0, -1);
  return t + '…';
}

async function drawRoundedImage(ctx: any, url: string | null, x: number, y: number, size: number, radius: number): Promise<void> {
  if (url) {
    try {
      const img = await loadImage(url);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, size, size, radius);
      ctx.clip();
      ctx.drawImage(img, x, y, size, size);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, y, size, size);
      ctx.restore();
      return;
    } catch { /* fallback */ }
  }
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, radius);
  ctx.fill();
}

// ── Card 1: Cover ─────────────────────────────────────────────────────────────
export async function buildCoverCard(username: string, totalScrobbles: number): Promise<Buffer> {
  const { canvas, ctx } = baseCanvas(BG_COVER);

  ctx.fillStyle = TEXT_SECONDARY;
  ctx.font = '12px sans-serif';
  ctx.fillText(tracked('SCROBBLER'), 40, 40);

  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(40, 55, 720, 1);

  ctx.fillStyle = TEXT_PRIMARY;
  ctx.font = 'bold 64px sans-serif';
  ctx.fillText(username, 40, 185);

  ctx.fillStyle = TEXT_PRIMARY;
  ctx.font = 'bold 120px sans-serif';
  ctx.fillText(totalScrobbles.toLocaleString('en-US'), 40, 330);

  ctx.fillStyle = TEXT_SECONDARY;
  ctx.font = '16px sans-serif';
  ctx.fillText(tracked('SCROBBLES'), 40, 370);

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  ctx.fillStyle = TEXT_DIM;
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, 760, 450);
  ctx.textAlign = 'left';

  await drawCardChrome(ctx, 40);
  return canvas.toBuffer('image/png');
}

// ── Card 2: Top Artists ───────────────────────────────────────────────────────
export async function buildArtistsCard(
  username: string,
  artists: { name: string; playcount: number }[],
  artistImages: (string | null)[]
): Promise<Buffer> {
  const { canvas, ctx } = baseCanvas();

  ctx.fillStyle = TEXT_SECONDARY;
  ctx.font = '11px sans-serif';
  ctx.fillText(tracked('TOP ARTISTS'), 40, 30);

  const podium = [
    { idx: 3, x: 30,  y: 120, size: 90,  namePx: 15, playPx: 12 },
    { idx: 1, x: 160, y: 90,  size: 120, namePx: 15, playPx: 12 },
    { idx: 0, x: 320, y: 60,  size: 160, namePx: 18, playPx: 13 },
    { idx: 2, x: 520, y: 90,  size: 120, namePx: 15, playPx: 12 },
    { idx: 4, x: 680, y: 120, size: 90,  namePx: 15, playPx: 12 },
  ];

  for (const p of podium) {
    const artist = artists[p.idx];
    if (!artist) continue;

    ctx.fillStyle = TEXT_DIM;
    ctx.font = `bold 12px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`#${p.idx + 1}`, p.x + p.size / 2, p.y - 8);

    await drawRoundedImage(ctx, artistImages[p.idx] ?? null, p.x, p.y, p.size, 8);

    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = `bold ${p.namePx}px sans-serif`;
    const nameY = p.y + p.size + 18;
    ctx.fillText(truncate(ctx, artist.name, p.size + 20), p.x + p.size / 2, nameY);

    ctx.fillStyle = TEXT_SECONDARY;
    ctx.font = `${p.playPx}px sans-serif`;
    ctx.fillText(`${artist.playcount.toLocaleString('en-US')} plays`, p.x + p.size / 2, nameY + 16);
  }

  ctx.textAlign = 'left';

  // Bottom strip — thin separator then #1 name + plays on same line
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 385, W, 1);

  const top1 = artists[0];
  if (top1) {
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(`#1  ${top1.name}`, 40, 420);
    ctx.fillStyle = TEXT_SECONDARY;
    ctx.font = '16px sans-serif';
    // Plays right-aligned on same visual line
    ctx.textAlign = 'right';
    ctx.fillText(`${top1.playcount.toLocaleString('en-US')} plays`, W - 40, 420);
    ctx.textAlign = 'left';
  }

  await drawCardChrome(ctx);
  return canvas.toBuffer('image/png');
}

// ── Card 3: Top Tracks ────────────────────────────────────────────────────────
export async function buildTracksCard(
  username: string,
  tracks: { name: string; artist: string; playcount: number }[],
  trackImages: (string | null)[]
): Promise<Buffer> {
  const { canvas, ctx } = baseCanvas();

  ctx.fillStyle = TEXT_SECONDARY;
  ctx.font = '11px sans-serif';
  ctx.fillText(tracked('TOP TRACKS'), 40, 30);

  const ROW_H = 72;
  for (let i = 0; i < Math.min(5, tracks.length); i++) {
    const track = tracks[i]!;
    const rowY = 50 + i * ROW_H;

    ctx.fillStyle = i % 2 === 0 ? BG : ROW_BG_ALT;
    ctx.fillRect(0, rowY, W, ROW_H);

    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, rowY + ROW_H - 1, W, 1);

    ctx.fillStyle = TEXT_DIM;
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${i + 1}`, 15, rowY + ROW_H / 2 + 7);

    await drawRoundedImage(ctx, trackImages[i] ?? null, 50, rowY + 10, 52, 4);

    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(truncate(ctx, track.name, 440), 115, rowY + 27);

    ctx.fillStyle = TEXT_SECONDARY;
    ctx.font = '12px sans-serif';
    ctx.fillText(truncate(ctx, track.artist, 440), 115, rowY + 47);

    ctx.fillStyle = TEXT_SECONDARY;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${track.playcount.toLocaleString('en-US')}`, 770, rowY + ROW_H / 2 + 5);
    ctx.textAlign = 'left';
  }

  await drawCardChrome(ctx);
  return canvas.toBuffer('image/png');
}

// ── Card 4: Taste DNA ─────────────────────────────────────────────────────────
export async function buildTasteCard(
  username: string,
  genres: { name: string; pct: number }[],
  discoveryScore: number
): Promise<Buffer> {
  const { canvas, ctx } = baseCanvas();

  ctx.fillStyle = TEXT_SECONDARY;
  ctx.font = '11px sans-serif';
  ctx.fillText(tracked('TASTE DNA'), 40, 30);

  const top5 = genres.slice(0, 5);
  const maxPct = top5[0]?.pct ?? 1;

  // Bar layout: label at x=40, bar from x=40 to x=720, pct at x=730
  const BAR_X = 40;
  const BAR_MAX_W = 680; // 40 to 720
  const PCT_X = 730;

  for (let i = 0; i < top5.length; i++) {
    const g = top5[i]!;
    const rowY = 50 + i * 52;

    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(g.name.charAt(0).toUpperCase() + g.name.slice(1), BAR_X, rowY + 14);

    // Bar background
    ctx.fillStyle = ROW_BG_ALT;
    ctx.beginPath();
    ctx.roundRect(BAR_X, rowY + 26, BAR_MAX_W, 8, 4);
    ctx.fill();

    // Bar fill — proportional to maxPct so top genre is always full width
    const barW = Math.max(4, (g.pct / maxPct) * BAR_MAX_W);
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(BAR_X, rowY + 26, barW, 8, 4);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = TEXT_SECONDARY;
    ctx.font = '13px sans-serif';
    ctx.fillText(`${g.pct}%`, PCT_X, rowY + 35);
  }

  // YOUR SOUND hero text
  const top3 = top5.slice(0, 3).map(g => g.name.charAt(0).toUpperCase() + g.name.slice(1)).join(' • ');
  ctx.fillStyle = TEXT_SECONDARY;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(tracked('YOUR SOUND'), W / 2, 340);

  ctx.fillStyle = TEXT_PRIMARY;
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(top3, W / 2, 368);

  // Underground/mainstream bar — centered, 300px wide
  const barTotalW = 300;
  const barX = (W - barTotalW) / 2;
  const barY = 410;

  ctx.fillStyle = ROW_BG_ALT;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barTotalW, 8, 4);
  ctx.fill();

  ctx.fillStyle = TEXT_PRIMARY;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.roundRect(barX, barY, (discoveryScore / 100) * barTotalW, 8, 4);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = TEXT_SECONDARY;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(tracked('UNDERGROUND'), barX, barY + 22);
  ctx.textAlign = 'right';
  ctx.fillText(tracked('MAINSTREAM'), barX + barTotalW, barY + 22);
  ctx.textAlign = 'left';

  await drawCardChrome(ctx);
  return canvas.toBuffer('image/png');
}

// ── Card 5: Stats ─────────────────────────────────────────────────────────────
export async function buildStatsCard(
  username: string,
  stats: {
    uniqueArtists: number;
    uniqueTracks: number;
    uniqueAlbums: number;
    discoveryScore: number;
    topGenre: string;
    dailyAvg: number;
  }
): Promise<Buffer> {
  const { canvas, ctx } = baseCanvas();

  ctx.fillStyle = TEXT_SECONDARY;
  ctx.font = '11px sans-serif';
  ctx.fillText(tracked('BY THE NUMBERS'), 40, 30);

  const topGenreDisplay = stats.topGenre.charAt(0).toUpperCase() + stats.topGenre.slice(1);

  const boxes = [
    { x: 30,  y: 55,  value: stats.uniqueArtists.toLocaleString('en-US'), label: tracked('ARTISTS') },
    { x: 290, y: 55,  value: stats.uniqueTracks.toLocaleString('en-US'),  label: tracked('TRACKS') },
    { x: 550, y: 55,  value: stats.uniqueAlbums.toLocaleString('en-US'),  label: tracked('ALBUMS') },
    { x: 30,  y: 220, value: `${stats.discoveryScore}%`,                  label: tracked('UNDERGROUND') },
    { x: 290, y: 220, value: topGenreDisplay,                              label: tracked('TOP GENRE') },
    { x: 550, y: 220, value: stats.dailyAvg.toLocaleString('en-US'),       label: tracked('DAILY AVG') },
  ];

  for (const box of boxes) {
    const BW = 220, BH = 140;
    ctx.fillStyle = BOX_BG;
    ctx.fillRect(box.x, box.y, BW, BH);

    const isLong = box.value.length > 8;
    ctx.fillStyle = TEXT_PRIMARY;
    ctx.font = `bold ${isLong ? 22 : 40}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(truncate(ctx, box.value, BW - 16), box.x + BW / 2, box.y + BH / 2 + (isLong ? 8 : 14));

    ctx.fillStyle = TEXT_SECONDARY;
    ctx.font = '11px sans-serif';
    ctx.fillText(box.label, box.x + BW / 2, box.y + BH - 14);
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = '#333333';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Made with Scrobbler', W / 2, 410);
  ctx.textAlign = 'left';

  await drawCardChrome(ctx);
  return canvas.toBuffer('image/png');
}
