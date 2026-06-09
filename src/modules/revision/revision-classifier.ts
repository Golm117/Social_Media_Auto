import { z } from "zod";
import type { ModelClient } from "../content-generator/content-generator.js";

export type RevisionStage = "script" | "code" | "voice" | "render";
// script = re-run copy/structure; code = regenerate code snippets (and re-verify);
// voice = re-run TTS; render = just re-compose the video (visual/music tweak)

export interface RevisionClassification {
  stages: RevisionStage[];
  reason?: string;
}

export interface RevisionClassifier {
  classify(instruction: string): Promise<RevisionClassification>;
}

const RevisionStageSchema = z.enum(["script", "code", "voice", "render"]);

const RevisionClassificationSchema = z.object({
  stages: z.array(RevisionStageSchema),
  reason: z.string().optional(),
});

const CLASSIFY_PROMPT_PREFIX = `You are classifying an operator revision instruction for a coding tutorial video pipeline.

The pipeline has four stages:
- script: Re-run the copy/structure stage (narration, hook, flow, pacing changes)
- code: Regenerate code snippets and re-verify them (code examples, algorithms, library changes)
- voice: Re-run text-to-speech (speaking speed, voice, pronunciation changes)
- render: Re-compose the video only (visuals, music, layout, color changes)

Determine which stages must be re-run for the following revision instruction, then return a
non-empty array of stage names and an optional brief reason.

Revision instruction:
`;

export class DefaultRevisionClassifier implements RevisionClassifier {
  constructor(private readonly client: ModelClient) {}

  async classify(instruction: string): Promise<RevisionClassification> {
    const prompt = `${CLASSIFY_PROMPT_PREFIX}${instruction}`;
    const result = await this.client.generateObject("glue", prompt, RevisionClassificationSchema);

    // Guard: never return empty stages — fall back to "script" (safest minimal re-run).
    if (result.stages.length === 0) {
      const fallback: RevisionStage = "script";
      return { stages: [fallback] };
    }

    // Explicitly construct return to satisfy exactOptionalPropertyTypes:
    // Zod infers reason as string|undefined but interface requires it absent (not undefined).
    const classification: RevisionClassification = { stages: result.stages };
    if (result.reason !== undefined) {
      classification.reason = result.reason;
    }
    return classification;
  }
}
