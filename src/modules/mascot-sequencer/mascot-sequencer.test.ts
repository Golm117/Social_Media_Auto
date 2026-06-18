import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DefaultMascotSequencer,
  type MascotAtlas,
  type MascotTrack,
  buildSegments,
} from "./mascot-sequencer.js";

const atlas: MascotAtlas = {
  image: "coddy-sheet.png",
  sheetSize: { w: 1432, h: 1432 },
  anchor: "bottom-center",
  defaultFps: 8,
  emotions: {
    happy: { frames: [{ x: 0, y: 0, w: 10, h: 10 }] },
    excited: { frames: [{ x: 10, y: 0, w: 10, h: 10 }] },
    damage: { frames: [{ x: 20, y: 0, w: 10, h: 10 }] },
  },
};

describe("buildSegments", () => {
  it("no cues → a single talking (happy) segment covering the whole duration", () => {
    const segs = buildSegments([], 3000, atlas);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ startMs: 0, endMs: 3000, emotion: "happy" });
    expect(segs[0]?.frames).toEqual(atlas.emotions.happy?.frames);
    expect(segs[0]?.fps).toBe(8);
  });

  it("distributes ordered cues evenly across the timeline (non-overlapping, full coverage)", () => {
    const segs = buildSegments(
      [
        { state: "intro", atStep: -1 },
        { state: "damage", atStep: 1 },
        { state: "excited", atStep: 2 },
      ],
      3000,
      atlas,
    );
    expect(segs.map((s) => [s.startMs, s.endMs])).toEqual([
      [0, 1000],
      [1000, 2000],
      [2000, 3000],
    ]);
    // intro resolves to excited; functional → sprite emotion mapping
    expect(segs.map((s) => s.emotion)).toEqual(["excited", "damage", "excited"]);
  });

  it("resolves frames from the atlas per resolved emotion", () => {
    const segs = buildSegments([{ state: "damage", atStep: 0 }], 1000, atlas);
    expect(segs[0]?.frames).toEqual(atlas.emotions.damage?.frames);
  });

  it("falls back to happy when an emotion is missing from the atlas", () => {
    // 'sad' isn't in this fake atlas → falls back to happy frames
    const segs = buildSegments([{ state: "sad", atStep: 0 }], 1000, atlas);
    expect(segs[0]?.frames).toEqual(atlas.emotions.happy?.frames);
  });
});

describe("DefaultMascotSequencer", () => {
  const outDir = join(tmpdir(), `coddy-mascot-test-${process.pid}`);
  afterAll(() => rm(outDir, { recursive: true, force: true }));

  it("writes a track JSON whose totalMs comes from the last word timing", async () => {
    const seq = new DefaultMascotSequencer(atlas, outDir);
    const { trackPath } = await seq.sequence(
      [
        { state: "talking", atStep: 0 },
        { state: "excited", atStep: 1 },
      ],
      [
        { word: "a", startMs: 0, endMs: 500 },
        { word: "b", startMs: 500, endMs: 1800 },
      ],
    );
    const track = JSON.parse(await readFile(trackPath, "utf8")) as MascotTrack;
    expect(track.totalMs).toBe(1800);
    expect(track.image).toBe("coddy-sheet.png");
    expect(track.anchor).toBe("bottom-center");
    expect(track.segments).toHaveLength(2);
    expect(track.segments.at(-1)?.endMs).toBe(1800);
  });
});
