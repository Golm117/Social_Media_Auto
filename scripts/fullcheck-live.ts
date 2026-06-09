import { readFileSync } from "node:fs";
import {
  DEFAULT_ROUTING,
  DefaultContentGenerator,
  OpenRouterModelClient,
} from "../src/modules/content-generator/content-generator.js";
import {
  DefaultMascotSequencer,
  loadAtlas,
} from "../src/modules/mascot-sequencer/mascot-sequencer.js";
import { DefaultVideoComposer } from "../src/modules/video-composer/video-composer.js";
import {
  DefaultVoiceSynthesizer,
  ElevenLabsTtsClient,
} from "../src/modules/voice-synthesizer/voice-synthesizer.js";
const env = (k: string) => {
  for (const l of readFileSync(".env", "utf8").split("\n")) {
    if (l.trimStart().startsWith("#") || !l.includes("=")) continue;
    const [a, ...r] = l.split("=");
    if (a.trim() === k)
      return r
        .join("=")
        .split(/\s+#/)[0]
        .trim()
        .replace(/^['"]|['"]$/g, "");
  }
  throw new Error(k);
};

const gen = new DefaultContentGenerator(
  new OpenRouterModelClient({ apiKey: env("OPENROUTER_API_KEY"), routing: DEFAULT_ROUTING }),
);
const sp = await gen.generate("How do I fetch data from an API in JavaScript using async await?");
console.log(`=== TEACHER-TONE VOICEOVER ===\n${sp.voiceoverText}\n`);
console.log(
  "code line counts:",
  sp.bodySteps.map((s) => (s.code ? s.code.split("\n").length : 0)),
);
const voice = new DefaultVoiceSynthesizer(
  new ElevenLabsTtsClient({
    apiKey: env("ELEVENLABS_API_KEY"),
    voiceId: env("ELEVENLABS_VOICE_ID"),
  }),
  "./data/tmp",
);
const { audioPath, timings } = await voice.synthesize(sp.voiceoverText);
const seq = new DefaultMascotSequencer(
  await loadAtlas("assets/mascot/coddy-atlas.json"),
  "./data/tmp",
);
const { trackPath } = await seq.sequence(sp.mascotCues, timings);
const { videoPath } = await new DefaultVideoComposer().compose({
  scriptPackage: sp,
  audioPath,
  mascotTrackPath: trackPath,
  timings,
  mascotSheetPath: "assets/mascot/coddy-sheet.png",
  outputPath: "./data/tmp/fullcheck.mp4",
});
console.log("VIDEO:", videoPath, "duration check next");
