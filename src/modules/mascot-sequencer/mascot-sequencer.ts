import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MascotState } from "../../domain/script-package.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MascotAtlas {
  image: string;
  sheetSize: { w: number; h: number };
  anchor: string;
  defaultFps: number;
  emotions: Record<string, { frames: AtlasFrame[] }>;
}

export interface MascotCue {
  state: MascotState;
  atStep: number;
}

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface MascotSegment {
  startMs: number;
  endMs: number;
  emotion: string; // resolved atlas emotion key
  frames: AtlasFrame[];
  fps: number;
}

export interface MascotTrack {
  image: string;
  anchor: string;
  sheetSize: { w: number; h: number };
  totalMs: number;
  segments: MascotSegment[];
}

export interface MascotSequencer {
  sequence(cues: MascotCue[], timings: WordTiming[]): Promise<{ trackPath: string }>;
}

// ─── Functional state → sprite emotion mapping ──────────────────────────────
// The sprite sheet has 7 real emotions; functional states reuse them.
export const DEFAULT_STATE_TO_EMOTION: Record<MascotState, string> = {
  idle: "happy",
  talking: "happy",
  intro: "excited",
  outro: "happy",
  happy: "happy",
  excited: "excited",
  sad: "sad",
  shy: "shy",
  cry: "cry",
  sleep: "sleep",
  damage: "damage",
};

const DEFAULT_TOTAL_MS = 3000;

export async function loadAtlas(path: string): Promise<MascotAtlas> {
  return JSON.parse(await readFile(path, "utf8")) as MascotAtlas;
}

// ─── Pure: cues + duration + atlas → non-overlapping segment timeline ───────

export function buildSegments(
  cues: MascotCue[],
  totalMs: number,
  atlas: MascotAtlas,
  stateToEmotion: Record<MascotState, string> = DEFAULT_STATE_TO_EMOTION,
): MascotSegment[] {
  const resolve = (state: MascotState): { emotion: string; frames: AtlasFrame[] } => {
    const emotion = stateToEmotion[state] ?? (atlas.emotions[state] ? state : "happy");
    const entry = atlas.emotions[emotion] ?? atlas.emotions.happy;
    return { emotion, frames: entry?.frames ?? [] };
  };
  const seg = (startMs: number, endMs: number, state: MascotState): MascotSegment => {
    const { emotion, frames } = resolve(state);
    return { startMs, endMs, emotion, frames, fps: atlas.defaultFps };
  };

  if (cues.length === 0) {
    return [seg(0, totalMs, "talking")];
  }

  // v1: cues are ordered by atStep and distributed EVENLY across the narration,
  // each occupying an equal slice. (Precise per-step word-timing alignment is a
  // future enhancement; atStep is used here only for ordering.)
  const sorted = [...cues].sort((a, b) => a.atStep - b.atStep);
  const n = sorted.length;
  const segments: MascotSegment[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.round((i / n) * totalMs);
    const end = Math.round(((i + 1) / n) * totalMs);
    const state = sorted[i]?.state ?? "talking";
    if (end <= start) continue;
    segments.push(seg(start, end, state));
  }
  // safety: never return empty
  if (segments.length === 0) return [seg(0, totalMs, "talking")];
  return segments;
}

// ─── DefaultMascotSequencer ─────────────────────────────────────────────────

export class DefaultMascotSequencer implements MascotSequencer {
  constructor(
    private readonly atlas: MascotAtlas,
    private readonly outputDir: string,
    private readonly stateToEmotion: Record<MascotState, string> = DEFAULT_STATE_TO_EMOTION,
  ) {}

  async sequence(cues: MascotCue[], timings: WordTiming[]): Promise<{ trackPath: string }> {
    const totalMs =
      timings.length > 0 ? Math.max(...timings.map((t) => t.endMs)) : DEFAULT_TOTAL_MS;
    const track: MascotTrack = {
      image: this.atlas.image,
      anchor: this.atlas.anchor,
      sheetSize: this.atlas.sheetSize,
      totalMs,
      segments: buildSegments(cues, totalMs, this.atlas, this.stateToEmotion),
    };
    await mkdir(this.outputDir, { recursive: true });
    // unique per call: a shared filename would let concurrent jobs clobber each other
    const trackPath = join(this.outputDir, `mascot-track-${randomUUID().slice(0, 8)}.json`);
    await writeFile(trackPath, JSON.stringify(track, null, 2));
    return { trackPath };
  }
}
