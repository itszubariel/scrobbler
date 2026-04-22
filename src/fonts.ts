import { GlobalFonts } from "@napi-rs/canvas";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

GlobalFonts.registerFromPath(
  join(__dirname, '../assets/fonts/Inter-Regular.ttf'),
  'Inter'
);
GlobalFonts.registerFromPath(
  join(__dirname, '../assets/fonts/Inter-Bold.ttf'),
  'Inter'
);
