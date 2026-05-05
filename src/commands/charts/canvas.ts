import { createCanvas, loadImage } from "@napi-rs/canvas";

const CELL = 200;

export interface GridItem {
  name: string;
  plays: number;
  imageUrl: string | null;
}

export async function buildGridCanvas(
  items: GridItem[],
  cols: number,
  rows: number,
  count: number,
): Promise<Buffer> {
  const canvas = createCanvas(cols * CELL, rows * CELL);
  const ctx = canvas.getContext("2d");

  for (let i = 0; i < count; i++) {
    const item = items[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * CELL;
    const y = row * CELL;

    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(x, y, CELL, CELL);

    if (item?.imageUrl) {
      try {
        const img = await loadImage(item.imageUrl);
        ctx.drawImage(img, x, y, CELL, CELL);
      } catch {
        /* fallback */
      }
    }

    const grad = ctx.createLinearGradient(x, y + CELL - 100, x, y + CELL);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.85)");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y + CELL - 100, CELL, 100);

    if (item) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 16px Inter";
      ctx.fillText(item.name, x + 10, y + CELL - 20, 190);
      ctx.fillStyle = "#cccccc";
      ctx.font = "12px Inter";
      ctx.fillText(
        `${item.plays.toLocaleString("en-US")} plays`,
        x + 10,
        y + CELL - 6,
        190,
      );
    }

    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, CELL, CELL);
  }

  return canvas.toBuffer("image/png");
}
