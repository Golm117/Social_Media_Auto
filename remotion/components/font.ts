import { loadFont } from "@remotion/google-fonts/PressStart2P";

// Retro pixel display font for headline/brand elements only — body text, captions
// and code stay in readable mono fonts.
const { fontFamily } = loadFont("normal", { weights: ["400"], subsets: ["latin"] });

export const PIXEL_FONT = `'${fontFamily}', monospace`;
