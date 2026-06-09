import { readFileSync } from "node:fs";
import type { PublishTarget } from "./modules/publisher/index.js";

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const [k, ...rest] = line.split("=");
    if (!k) continue;
    out[k.trim()] = rest
      .join("=")
      .split(/\s+#/)[0]
      ?.trim()
      .replace(/^['"]|['"]$/g, "") as string;
  }
  return out;
}

export interface AppConfig {
  openRouterApiKey: string;
  e2bApiKey: string;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  telegramBotToken: string;
  telegramOperatorChatId: number;
  blotatoApiKey: string;
  blotatoInstagramId: string;
  blotatoFacebookId: string;
  blotatoFacebookPageId: string;
  blotatoTiktokId: string;
  publishTargets: PublishTarget[];
  publicBaseUrl: string;
  databasePath: string;
  outputDir: string;
  atlasPath: string;
  mascotSheetPath: string;
  scheduleSlots: string[];
  scheduleTimeZone: string;
  useMockPublisher: boolean;
}

export function loadConfig(envPath = ".env"): AppConfig {
  const e = { ...parseEnvFile(envPath), ...process.env } as Record<string, string>;
  const need = (k: string): string => {
    const v = e[k];
    if (!v) throw new Error(`Missing required env var: ${k}`);
    return v;
  };
  return {
    openRouterApiKey: need("OPENROUTER_API_KEY"),
    e2bApiKey: need("E2B_API_KEY"),
    elevenLabsApiKey: need("ELEVENLABS_API_KEY"),
    elevenLabsVoiceId: need("ELEVENLABS_VOICE_ID"),
    telegramBotToken: need("TELEGRAM_BOT_TOKEN"),
    telegramOperatorChatId: Number(need("TELEGRAM_OPERATOR_CHAT_ID")),
    blotatoApiKey: e.BLOTATO_API_KEY ?? "",
    blotatoInstagramId: e.BLOTATO_INSTAGRAM_ID ?? "",
    blotatoFacebookId: e.BLOTATO_FACEBOOK_ID ?? "",
    blotatoFacebookPageId: e.BLOTATO_FACEBOOK_PAGE_ID ?? "",
    blotatoTiktokId: e.BLOTATO_TIKTOK_ID ?? "",
    publishTargets: (e.PUBLISH_TARGETS ?? "instagram,facebook,tiktok")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as PublishTarget[],
    publicBaseUrl: e.PUBLIC_BASE_URL ?? "",
    databasePath: e.DATABASE_PATH ?? "./data/coddy.db",
    outputDir: e.OUTPUT_DIR ?? "./data/media",
    atlasPath: e.MASCOT_ATLAS ?? "assets/mascot/coddy-atlas.json",
    mascotSheetPath: e.MASCOT_SHEET ?? "assets/mascot/coddy-sheet.png",
    scheduleSlots: (e.SCHEDULE_SLOTS ?? "09:00,17:00").split(",").map((s) => s.trim()),
    scheduleTimeZone: e.SCHEDULE_TZ ?? "America/Toronto",
    // default true: approving won't hit real socials until you flip this off
    useMockPublisher: (e.USE_MOCK_PUBLISHER ?? "true").toLowerCase() !== "false",
  };
}
