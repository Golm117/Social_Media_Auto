import {
  DefaultMascotSequencer,
  loadAtlas,
} from "../src/modules/mascot-sequencer/mascot-sequencer.js";

const atlas = await loadAtlas("assets/mascot/coddy-atlas.json");
console.log("loaded atlas — emotions:", Object.keys(atlas.emotions), "fps:", atlas.defaultFps);
const seq = new DefaultMascotSequencer(atlas, "./data/tmp");
const cues = [
  { state: "intro" as const, atStep: -1 },
  { state: "talking" as const, atStep: 0 },
  { state: "damage" as const, atStep: 1 },
  { state: "excited" as const, atStep: 2 },
  { state: "outro" as const, atStep: 3 },
];
const timings = [
  { word: "Three", startMs: 0, endMs: 500 },
  { word: "loops", startMs: 500, endMs: 1200 },
  { word: "done", startMs: 1200, endMs: 3297 },
];
const { trackPath } = await seq.sequence(cues, timings);
const track = JSON.parse(await (await import("node:fs/promises")).readFile(trackPath, "utf8"));
console.log("trackPath:", trackPath, "| totalMs:", track.totalMs);
for (const s of track.segments)
  console.log(
    `  ${s.startMs}-${s.endMs}ms  ${s.emotion}  (${s.frames.length} frames @ ${s.fps}fps)`,
  );
