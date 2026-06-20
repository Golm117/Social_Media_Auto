import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { DefaultCodeVerifier, E2BSandbox } from "./modules/code-verifier/index.js";
import {
  DEFAULT_ROUTING,
  DefaultContentGenerator,
  OpenRouterModelClient,
} from "./modules/content-generator/index.js";
import { TelegramGateway } from "./modules/conversation-gateway/index.js";
import { SqliteJobStore } from "./modules/job-store/job-store.js";
import { DefaultMascotSequencer, loadAtlas } from "./modules/mascot-sequencer/index.js";
import { MockPublisher, type Publisher } from "./modules/publisher/index.js";
import { DefaultScheduler } from "./modules/scheduler/index.js";
import { StackOverflowTopicSource } from "./modules/topic-source/index.js";
import { DefaultVideoComposer } from "./modules/video-composer/index.js";
import { DefaultVoiceSynthesizer, ElevenLabsTtsClient } from "./modules/voice-synthesizer/index.js";
import { Runtime } from "./runtime/runtime.js";

const TICK_MS = 60_000;

async function main() {
  const cfg = loadConfig();
  await mkdir(cfg.outputDir, { recursive: true });

  const store = new SqliteJobStore(cfg.databasePath);
  const contentGenerator = new DefaultContentGenerator(
    new OpenRouterModelClient({ apiKey: cfg.openRouterApiKey, routing: DEFAULT_ROUTING }),
  );
  const codeVerifier = new DefaultCodeVerifier(new E2BSandbox({ apiKey: cfg.e2bApiKey }));
  const voice = new DefaultVoiceSynthesizer(
    new ElevenLabsTtsClient({
      apiKey: cfg.elevenLabsApiKey,
      voiceId: cfg.elevenLabsVoiceId,
      modelId: cfg.elevenLabsModelId,
      ...(cfg.elevenLabsStability !== undefined ? { stability: cfg.elevenLabsStability } : {}),
    }),
    cfg.outputDir,
  );

  let musicPath: string | undefined;
  if (cfg.musicPath) {
    if (existsSync(cfg.musicPath)) musicPath = cfg.musicPath;
    else console.warn(`⚠️  MUSIC_PATH not found: ${cfg.musicPath} — rendering without music.`);
  }
  const mascot = new DefaultMascotSequencer(await loadAtlas(cfg.atlasPath), cfg.outputDir);
  const video = new DefaultVideoComposer();
  const gateway = new TelegramGateway({
    token: cfg.telegramBotToken,
    operatorChatId: cfg.telegramOperatorChatId,
  });

  let publisher: Publisher;
  if (cfg.useMockPublisher) {
    publisher = new MockPublisher();
    console.log("⚠️  Using MOCK publisher (approving will NOT post to real accounts).");
  } else {
    const { BlotatoPublisher } = await import("./modules/publisher/blotato-publisher.js");
    const blotatoCfg: ConstructorParameters<typeof BlotatoPublisher>[0] = {
      apiKey: cfg.blotatoApiKey,
      accountIds: {
        instagram: cfg.blotatoInstagramId,
        facebook: cfg.blotatoFacebookId,
        tiktok: cfg.blotatoTiktokId,
      },
    };
    if (cfg.blotatoFacebookPageId) blotatoCfg.facebookPageId = cfg.blotatoFacebookPageId;
    if (cfg.publicBaseUrl) blotatoCfg.publicBaseUrl = cfg.publicBaseUrl;
    publisher = new BlotatoPublisher(blotatoCfg);
    console.log("🚀 Using LIVE Blotato publisher.");
  }

  const runtime = new Runtime({
    store,
    contentGenerator,
    codeVerifier,
    voice,
    mascot,
    video,
    publisher,
    gateway,
    scheduler: new DefaultScheduler(),
    schedulerConfig: { slots: cfg.scheduleSlots, timeZone: cfg.scheduleTimeZone },
    ...(cfg.autoTopicLanguages.length > 0
      ? {
          topicSource: new StackOverflowTopicSource(
            cfg.stackOverflowApiKey ? { apiKey: cfg.stackOverflowApiKey } : {},
          ),
          autoTopicLanguages: cfg.autoTopicLanguages,
        }
      : {}),
    outputDir: cfg.outputDir,
    mascotSheetPath: cfg.mascotSheetPath,
    ...(musicPath ? { musicPath } : {}),
    publishTargets: cfg.publishTargets,
    manualTargets: cfg.manualTargets,
    brandHandle: cfg.brandHandle,
    now: () => new Date(),
  });

  runtime.start();
  await runtime.recover(); // jobs left in-flight by a previous run (crash/restart)
  gateway.start();

  // Fires the daily auto-topic once per local day, at or after AUTO_TOPIC_HOUR. Checked
  // on each tick so a sleeping/restarted Mac still triggers it on the next wake that day.
  const autoTopicEnabled = cfg.autoTopicLanguages.length > 0;
  const [autoH, autoM] = cfg.autoTopicHour.split(":").map(Number);
  let lastAutoTopicDay = "";
  const localDay = (now: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: cfg.scheduleTimeZone }).format(now);
  const localMinutes = (now: Date) => {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: cfg.scheduleTimeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const h = Number(p.find((x) => x.type === "hour")?.value ?? 0);
    const m = Number(p.find((x) => x.type === "minute")?.value ?? 0);
    return h * 60 + m;
  };
  const triggerMinutes = (autoH ?? 9) * 60 + (autoM ?? 0);

  const ticker = setInterval(() => {
    const now = new Date();
    runtime.tick().catch((e) => console.error("tick error:", e));
    if (autoTopicEnabled) {
      const day = localDay(now);
      if (day !== lastAutoTopicDay && localMinutes(now) >= triggerMinutes) {
        lastAutoTopicDay = day;
        runtime.autoTopic().catch((e) => console.error("auto-topic error:", e));
      }
    }
  }, TICK_MS);

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — shutting down…`);
    clearInterval(ticker);
    await gateway.stop().catch(() => {});
    store.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  console.log("✅ CodeWithQuirk bot running. DM the bot a coding question.");
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
