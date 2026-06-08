import type { ScriptPackage } from "../../domain/script-package.js";

// TODO: slice 8
export interface VideoComposer {
  compose(
    scriptPackage: ScriptPackage,
    mascotTrackPath: string,
    audioPath: string,
  ): Promise<{ videoPath: string }>;
}
