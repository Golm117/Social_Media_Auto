import type { ScriptPackage } from "../../domain/script-package.js";

// ─── Shared props/types (safe to import from the browser-side Remotion code —
//     no Node-only or heavy deps in this file) ────────────────────────────────

export interface HighlightedToken {
  content: string;
  color: string;
}
export type HighlightedLine = HighlightedToken[];

export interface CoddyAtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface CoddyMascotSegment {
  startMs: number;
  endMs: number;
  emotion: string;
  frames: CoddyAtlasFrame[];
  fps: number;
}
export interface CoddyMascotTrack {
  image: string;
  anchor: string;
  sheetSize: { w: number; h: number };
  totalMs: number;
  segments: CoddyMascotSegment[];
}

export interface CoddyWordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

// type alias (not interface): the implicit index signature lets it satisfy
// Remotion's Record<string, unknown> props constraint in <Composition>.
export type CoddyVideoProps = {
  hook: string;
  templateId: string;
  steps: Array<{
    text: string;
    codeLines?: HighlightedLine[] | undefined;
    language?: string | undefined;
  }>;
  timings: CoddyWordTiming[];
  audioSrc: string;
  /** Optional looping background-music file (relative to the bundle public dir). */
  musicSrc?: string;
  mascotSheetSrc: string;
  mascotTrack: CoddyMascotTrack;
  /** Length of the content (voiceover) portion — steps/captions/audio span this. */
  durationMs: number;
  /** Trailing "Like & Follow" end card, appended after the content. */
  endCardMs: number;
  /** Brand handle shown on the end card (e.g. "@CodeWithQuirk"). */
  brandHandle: string;
  fps: number;
};

export interface ComposeInput {
  scriptPackage: ScriptPackage;
  audioPath: string;
  /** Optional background-music file, mixed quietly under the voiceover. */
  musicPath?: string;
  mascotTrackPath: string;
  timings: CoddyWordTiming[];
  mascotSheetPath: string;
  outputPath: string;
  /** Brand handle for the end card; defaults to "@CodeWithQuirk". */
  brandHandle?: string;
}

export interface VideoComposer {
  compose(input: ComposeInput): Promise<{ videoPath: string }>;
}

export const VIDEO_FPS = 30;
export const VIDEO_TAIL_MS = 800;
/** Duration of the trailing "Like & Follow" end card. */
export const END_CARD_MS = 2500;
/** End-card fade-in duration. */
export const END_CARD_FADE_MS = 400;

// ─── Pure helpers (unit-tested; used by both Node composer and the composition) ─

export function computeDurationMs(track: CoddyMascotTrack, timings: CoddyWordTiming[]): number {
  const lastTiming = timings.length > 0 ? Math.max(...timings.map((t) => t.endMs)) : 0;
  return Math.max(track.totalMs, lastTiming) + VIDEO_TAIL_MS;
}

/** Mascot segment active at `ms` (holds the last segment after the track ends). */
export function segmentAt(track: CoddyMascotTrack, ms: number): CoddyMascotSegment | null {
  return (
    track.segments.find((s) => ms >= s.startMs && ms < s.endMs) ?? track.segments.at(-1) ?? null
  );
}

/** Which sprite sub-frame is visible at `ms`, given the mascot track. */
export function frameAt(track: CoddyMascotTrack, ms: number): CoddyAtlasFrame | null {
  const seg = segmentAt(track, ms);
  if (!seg || seg.frames.length === 0) return null;
  const elapsed = Math.max(0, ms - seg.startMs);
  const idx = Math.floor((elapsed / 1000) * seg.fps) % seg.frames.length;
  return seg.frames[idx] ?? seg.frames[0] ?? null;
}

/** Active caption word index at `ms` (-1 if none). */
export function activeWordIndex(timings: CoddyWordTiming[], ms: number): number {
  return timings.findIndex((t) => ms >= t.startMs && ms < t.endMs);
}

/** Which body step is showing at `ms` (steps evenly distributed across duration). */
export function activeStepIndex(stepCount: number, ms: number, durationMs: number): number {
  if (stepCount <= 0 || durationMs <= 0) return 0;
  return Math.min(stepCount - 1, Math.floor((ms / durationMs) * stepCount));
}

/**
 * End-card opacity at `ms`: 0 during the content, then a quick fade-in once the
 * content has ended. `contentDurationMs` is the voiceover/content length; the
 * card occupies the trailing `endCardMs` after it.
 */
export function endCardOpacity(ms: number, contentDurationMs: number, endCardMs: number): number {
  if (endCardMs <= 0) return 0;
  const into = ms - contentDurationMs;
  if (into <= 0) return 0;
  return Math.min(1, into / END_CARD_FADE_MS);
}
