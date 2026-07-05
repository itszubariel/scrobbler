import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = join(__dirname, "../../../assets/images/scrobbler_logo.png");

export interface TimelinePoint {
  label: string;  // e.g. "Jan 24"
  value: number;
}

export interface TimelineSeries {
  name: string;
  color: string;
  points: TimelinePoint[];
}

const WIDTH = 900;
const HEIGHT = 420;
const PAD_TOP = 90;
const PAD_RIGHT = 40;
const PAD_BOTTOM = 70;
const PAD_LEFT = 80;

const CHART_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const CHART_H = HEIGHT - PAD_TOP - PAD_BOTTOM;

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export async function buildTimelineCanvas(
  series: TimelineSeries[],
  title: string,
  _subtitle: string,
): Promise<Buffer> {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle top-left glow
  const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, 280);
  haze.addColorStop(0, "rgba(120, 60, 220, 0.15)");
  haze.addColorStop(0.6, "rgba(80, 30, 160, 0.06)");
  haze.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Collect all values across all series for axis scaling
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const maxVal = Math.max(...allValues, 1);
  const minVal = 0;
  const range = maxVal - minVal || 1;

  // Use labels from first series (all series share the same x-axis)
  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const pointCount = labels.length;

  // ── Grid lines & Y-axis labels ─────────────────────────────────────
  const gridSteps = 5;
  ctx.font = "13px Inter";
  ctx.textAlign = "right";

  for (let i = 0; i <= gridSteps; i++) {
    const ratio = i / gridSteps;
    const yVal = Math.round(minVal + range * ratio);
    const y = PAD_TOP + CHART_H - CHART_H * ratio;

    ctx.strokeStyle = i === 0 ? "#2a2a2a" : "#1e1e1e";
    ctx.lineWidth = i === 0 ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, y);
    ctx.lineTo(PAD_LEFT + CHART_W, y);
    ctx.stroke();

    ctx.fillStyle = "#555555";
    ctx.fillText(
      yVal >= 1000 ? `${(yVal / 1000).toFixed(1)}k` : `${yVal}`,
      PAD_LEFT - 10,
      y + 5,
    );
  }

  // ── X-axis labels ──────────────────────────────────────────────────
  ctx.textAlign = "center";
  ctx.fillStyle = "#555555";
  ctx.font = "13px Inter";

  // Only show a label every N points to avoid crowding
  const maxLabels = 12;
  const labelStep = Math.ceil(pointCount / maxLabels);

  for (let i = 0; i < pointCount; i++) {
    if (i % labelStep !== 0 && i !== pointCount - 1) continue;
    const x = PAD_LEFT + (i / Math.max(pointCount - 1, 1)) * CHART_W;
    ctx.fillText(labels[i] ?? "", x, PAD_TOP + CHART_H + 22);
  }

  // ── Series lines & area fills ──────────────────────────────────────
  for (const s of series) {
    if (s.points.length < 2) continue;

    const pts = s.points.map((p, i) => ({
      x: PAD_LEFT + (i / Math.max(s.points.length - 1, 1)) * CHART_W,
      y: PAD_TOP + CHART_H - ((p.value - minVal) / range) * CHART_H,
    }));

    // Area fill
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, PAD_TOP + CHART_H);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(pts[pts.length - 1]!.x, PAD_TOP + CHART_H);
    ctx.closePath();

    const areaGrad = ctx.createLinearGradient(0, PAD_TOP, 0, PAD_TOP + CHART_H);
    areaGrad.addColorStop(0, hexToRgba(s.color, 0.12));
    areaGrad.addColorStop(1, hexToRgba(s.color, 0.01));
    ctx.fillStyle = areaGrad;
    ctx.fill();
    ctx.restore();

    // Line
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) {
      // Smooth curve via control points
      const prev = pts[i - 1]!;
      const curr = pts[i]!;
      const cpx = (prev.x + curr.x) / 2;
      ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
    }
    ctx.stroke();
    ctx.restore();

    // Dots on each point
    for (const pt of pts) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.strokeStyle = "#111111";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // ── Title ──────────────────────────────────────────────────────────
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px Inter";
  ctx.fillText(title, PAD_LEFT, 44);

  // ── Legend (multi-series only) ─────────────────────────────────────
  if (series.length > 1) {
    const LEGEND_Y = PAD_TOP + CHART_H + 44;
    let legendX = PAD_LEFT;
    ctx.font = "13px Inter";
    for (const s of series) {
      ctx.fillStyle = s.color;
      ctx.fillRect(legendX, LEGEND_Y - 10, 14, 14);
      ctx.fillStyle = "#aaaaaa";
      ctx.textAlign = "left";
      ctx.fillText(s.name, legendX + 18, LEGEND_Y);
      legendX += ctx.measureText(s.name).width + 40;
    }
  }

  // ── Logo ───────────────────────────────────────────────────────────
  try {
    const logo = await loadImage(LOGO_PATH);
    const LOGO_SIZE = 32;
    const lx = WIDTH - LOGO_SIZE - 16;
    const ly = 14;
    ctx.save();
    ctx.beginPath();
    ctx.arc(lx + LOGO_SIZE / 2, ly + LOGO_SIZE / 2, LOGO_SIZE / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, lx, ly, LOGO_SIZE, LOGO_SIZE);
    ctx.restore();
  } catch {
    /* skip */
  }

  return canvas.toBuffer("image/png");
}
