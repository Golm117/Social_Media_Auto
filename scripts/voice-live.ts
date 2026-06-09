import { readFileSync } from "node:fs";
import { DefaultVoiceSynthesizer, ElevenLabsTtsClient } from "../src/modules/voice-synthesizer/voice-synthesizer.js";

function envVal(key: string): string {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    if (line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const [k, ...rest] = line.split("=");
    if (k.trim() === key) return rest.join("=").split(/\s+#/)[0].trim().replace(/^['"]|['"]$/g, "");
  }
  throw new Error(`missing ${key}`);
}

const client = new ElevenLabsTtsClient({
  apiKey: envVal("ELEVENLABS_API_KEY"),
  voiceId: envVal("ELEVENLABS_VOICE_ID"),
});
const synth = new DefaultVoiceSynthesizer(client, "./data/tmp");
const text = "Hey! Three ways to loop in JavaScript, coming right up.";
console.log("synthesizing:", JSON.stringify(text));
const r = await synth.synthesize(text);
console.log("audioPath:", r.audioPath);
console.log("word count:", r.timings.length);
console.log("first 4 timings:", r.timings.slice(0, 4));
console.log("last timing:", r.timings.at(-1));
