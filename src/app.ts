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
    }),
    cfg.outputDir,
  );
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
    outputDir: cfg.outputDir,
    mascotSheetPath: cfg.mascotSheetPath,
    publishTargets: cfg.publishTargets,
    brandHandle: cfg.brandHandle,
    now: () => new Date(),
  });

  runtime.start();
  gateway.start();
  setInterval(() => {
    runtime.tick().catch((e) => console.error("tick error:", e));
  }, TICK_MS);

  console.log("✅ CodeWithQuirk bot running. DM the bot a coding question.");
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
