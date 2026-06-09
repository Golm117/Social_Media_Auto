import { readFileSync } from "node:fs";
import {
  DEFAULT_ROUTING,
  DefaultContentGenerator,
  OpenRouterModelClient,
} from "../src/modules/content-generator/content-generator.js";
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
const sp = await gen.generate("What is a variable in JavaScript?");
console.log("=== VOICEOVER (should contain a few [emotion] tags) ===\n" + sp.voiceoverText + "\n");
const voice = new DefaultVoiceSynthesizer(
  new ElevenLabsTtsClient({
    apiKey: env("ELEVENLABS_API_KEY"),
    voiceId: env("ELEVENLABS_VOICE_ID"),
    modelId: "eleven_v3",
  }),
  "./data/tmp",
);
const { timings } = await voice.synthesize(sp.voiceoverText);
const caption = timings.map((t) => t.word).join(" ");
console.log("=== CAPTION WORDS (must NOT contain [tags]) ===\n" + caption);
console.log("\nbracket leaked into captions?", /[\[\]]/.test(caption) ? "YES ❌" : "NO ✅");
