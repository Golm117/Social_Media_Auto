import { describe, expect, it } from "vitest";
import {
  type CoddyMascotTrack,
  activeStepIndex,
  activeWordIndex,
  computeDurationMs,
  frameAt,
  segmentAt,
} from "./coddy-props.js";

const track: CoddyMascotTrack = {
  image: "coddy-sheet.png",
  anchor: "bottom-center",
  sheetSize: { w: 1432, h: 1432 },
  totalMs: 2000,
  segments: [
    {
      startMs: 0,
      endMs: 1000,
      emotion: "happy",
      fps: 2,
      frames: [
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 10, y: 0, w: 10, h: 10 },
      ],
    },
    {
      startMs: 1000,
      endMs: 2000,
      emotion: "excited",
      fps: 2,
      frames: [{ x: 20, y: 0, w: 10, h: 10 }],
    },
  ],
};

describe("computeDurationMs", () => {
  it("is max(track.totalMs, last timing) + tail", () => {
    expect(computeDurationMs(track, [{ word: "x", startMs: 0, endMs: 2500 }])).toBe(3300); // 2500 + 800
    expect(computeDurationMs(track, [])).toBe(2800); // 2000 + 800
  });
});

describe("frameAt", () => {
  it("cycles frames within the active segment by fps", () => {
    // seg0 fps=2 → frame flips every 500ms
    expect(frameAt(track, 0)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(frameAt(track, 600)).toEqual({ x: 10, y: 0, w: 10, h: 10 });
  });
  it("selects the right segment", () => {
    expect(frameAt(track, 1200)).toEqual({ x: 20, y: 0, w: 10, h: 10 });
  });
  it("clamps past the end to the last segment", () => {
    expect(frameAt(track, 99999)).toEqual({ x: 20, y: 0, w: 10, h: 10 });
  });
  it("returns null when no frames", () => {
    expect(frameAt({ ...track, segments: [] }, 0)).toBeNull();
  });
});

describe("segmentAt", () => {
  it("returns the segment covering ms", () => {
    expect(segmentAt(track, 500)?.emotion).toBe("happy");
    expect(segmentAt(track, 1200)?.emotion).toBe("excited");
  });
  it("holds the last segment past the end", () => {
    expect(segmentAt(track, 99999)?.emotion).toBe("excited");
  });
  it("returns null on an empty track", () => {
    expect(segmentAt({ ...track, segments: [] }, 0)).toBeNull();
  });
});

describe("activeWordIndex", () => {
  const timings = [
    { word: "a", startMs: 0, endMs: 500 },
    { word: "b", startMs: 500, endMs: 1000 },
  ];
  it("finds the active word", () => {
    expect(activeWordIndex(timings, 600)).toBe(1);
  });
  it("returns -1 outside any word", () => {
    expect(activeWordIndex(timings, 2000)).toBe(-1);
  });
});

describe("activeStepIndex", () => {
  it("maps time to an evenly-distributed step", () => {
    expect(activeStepIndex(3, 0, 3000)).toBe(0);
    expect(activeStepIndex(3, 1500, 3000)).toBe(1);
    expect(activeStepIndex(3, 2999, 3000)).toBe(2);
  });
  it("clamps to last step and handles edge inputs", () => {
    expect(activeStepIndex(3, 9999, 3000)).toBe(2);
    expect(activeStepIndex(0, 100, 3000)).toBe(0);
  });
});
