import type { MascotState } from "../../domain/script-package.js";

// TODO: slice 7
export interface MascotSequencer {
  sequence(
    cues: Array<{ state: MascotState; atStep: number }>,
    timings: Array<{ word: string; startMs: number; endMs: number }>,
  ): Promise<{ trackPath: string }>;
}
