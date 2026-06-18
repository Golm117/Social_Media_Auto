import { readFileSync } from "node:fs";
import type { ScriptPackage } from "../src/domain/script-package.js";
import {
  DefaultMascotSequencer,
  loadAtlas,
} from "../src/modules/mascot-sequencer/mascot-sequencer.js";
import { DefaultVideoComposer } from "../src/modules/video-composer/video-composer.js";
import {
  DefaultVoiceSynthesizer,
  ElevenLabsTtsClient,
} from "../src/modules/voice-synthesizer/voice-synthesizer.js";

function envVal(key: string): string {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    if (line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const [k, ...rest] = line.split("=");
    if (k.trim() === key)
      return rest
        .join("=")
        .split(/\s+#/)[0]
        .trim()
        .replace(/^['"]|['"]$/g, "");
  }
  throw new Error(`missing ${key}`);
}

const sp: ScriptPackage = {
  templateId: "x-in-3-steps",
  hook: "3 ways to loop in JavaScript",
  bodySteps: [
    {
      text: "1. The classic for loop",
      code: "for (let i = 0; i < 3; i++) {\n  console.log(i);\n}",
      language: "javascript",
    },
    {
      text: "2. for...of — cleaner",
      code: "for (const n of [0, 1, 2]) {\n  console.log(n);\n}",
      language: "javascript",
    },
    {
      text: "3. forEach — functional",
      code: "[0, 1, 2].forEach((n) => console.log(n));",
      language: "javascript",
    },
  ],
  voiceoverText:
    "Here are three ways to loop in JavaScript. First, the classic for loop. Second, for of, which reads cleaner. Third, for each, the functional way!",
  captionsText: "3 ways to loop in JavaScript",
  socialCaption: "Still writing for-loops the old way? Here are 3. #javascript #coding #webdev",
  hashtags: ["javascript", "coding", "webdev"],
  coverSpec: { title: "3 ways to loop" },
  mascotCues: [
    { state: "intro", atStep: -1 },
    { state: "talking", atStep: 0 },
    { state: "happy", atStep: 1 },
    { state: "excited", atStep: 2 },
    { state: "outro", atStep: 3 },
  ],
};

console.log("1/3 synthesizing voiceover (ElevenLabs)…");
const voice = new DefaultVoiceSynthesizer(
  new ElevenLabsTtsClient({
    apiKey: envVal("ELEVENLABS_API_KEY"),
    voiceId: envVal("ELEVENLABS_VOICE_ID"),
  }),
  "./data/tmp",
);
const { audioPath, timings } = await voice.synthesize(sp.voiceoverText);
console.log(`   audio: ${audioPath} (${timings.length} words)`);

console.log("2/3 sequencing Coddy…");
const seq = new DefaultMascotSequencer(
  await loadAtlas("assets/mascot/coddy-atlas.json"),
  "./data/tmp",
);
const { trackPath } = await seq.sequence(sp.mascotCues, timings);
console.log(`   track: ${trackPath}`);

console.log("3/3 rendering video (Remotion)…");
const { videoPath } = await new DefaultVideoComposer().compose({
  scriptPackage: sp,
  audioPath,
  mascotTrackPath: trackPath,
  timings,
  mascotSheetPath: "assets/mascot/coddy-sheet.png",
  outputPath: "./data/tmp/coddy-test.mp4",
});
console.log("✅ VIDEO:", videoPath);
