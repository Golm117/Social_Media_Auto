import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import { z } from "zod";
import {
  MascotStateSchema,
  ScriptPackageSchema,
  TemplateIdSchema,
} from "../../domain/script-package.js";
import type { ScriptPackage, TemplateId } from "../../domain/script-package.js";

// ─── Routing types ─────────────────────────────────────────────────────────

export type ModelRole = "code" | "copy" | "glue";

export interface RoutingConfig {
  code: string;
  copy: string;
  glue: string;
}

// ─── ModelClient interface (the injectable boundary) ───────────────────────

export interface ModelClient {
  generateObject<T>(role: ModelRole, prompt: string, schema: z.ZodType<T>): Promise<T>;
}

// ─── ContentGenerator interface ────────────────────────────────────────────

export interface ContentGenerator {
  generate(question: string, revision?: string): Promise<ScriptPackage>;
}

// ─── Default routing config ────────────────────────────────────────────────

// NOTE: These slugs must be validated against OpenRouter's live catalog when
// API keys are wired (a later integration pass) — they are not network-tested
// in this slice.
export const DEFAULT_ROUTING: RoutingConfig = {
  code: "anthropic/claude-sonnet-4.6",
  copy: "openai/gpt-5.5",
  glue: "google/gemini-3.5-flash",
};

// ─── OpenRouterModelClient (real impl) ────────────────────────────────────

export class OpenRouterModelClient implements ModelClient {
  private readonly provider: ReturnType<typeof createOpenRouter>;
  private readonly routing: RoutingConfig;

  constructor({ apiKey, routing }: { apiKey: string; routing: RoutingConfig }) {
    this.routing = routing;
    this.provider = createOpenRouter({ apiKey });
  }

  async generateObject<T>(role: ModelRole, prompt: string, schema: z.ZodType<T>): Promise<T> {
    const model = this.provider.chat(this.routing[role]);
    // Cap output tokens — OpenRouter reserves credits for the full max_tokens, and the
    // default (64k) is both wasteful and can exceed a low account balance.
    const result = await generateObject({ model, schema, prompt, maxOutputTokens: 4000 });
    return result.object;
  }
}

// ─── Pipeline schemas ──────────────────────────────────────────────────────

const CodeLanguageSchema = z.enum(["javascript", "typescript", "python"]);

const OutlineSchema = z.object({
  templateId: TemplateIdSchema,
  steps: z.array(
    z.object({
      text: z.string(),
      needsCode: z.boolean(),
      // nullable (not optional): OpenAI strict structured output requires every key present
      language: CodeLanguageSchema.nullable(),
    }),
  ),
});

const CodeStageOutputSchema = z.object({
  snippets: z.array(
    z.object({
      stepIndex: z.number().int(),
      code: z.string(),
      language: CodeLanguageSchema,
    }),
  ),
});

const CopyStageOutputSchema = z.object({
  hook: z.string(),
  voiceoverText: z.string(),
  captionsText: z.string(),
  socialCaption: z.string(),
  hashtags: z.array(z.string()),
  coverSpec: z.object({
    title: z.string(),
    subtitle: z.string().nullable(),
  }),
  mascotCues: z.array(
    z.object({
      state: MascotStateSchema,
      atStep: z.number().int(),
    }),
  ),
});

type Outline = z.infer<typeof OutlineSchema>;
type CodeStageOutput = z.infer<typeof CodeStageOutputSchema>;
type CopyStageOutput = z.infer<typeof CopyStageOutputSchema>;

// ─── DefaultContentGenerator ───────────────────────────────────────────────

export class DefaultContentGenerator implements ContentGenerator {
  constructor(private readonly client: ModelClient) {}

  async generate(question: string, revision?: string): Promise<ScriptPackage> {
    const outline = await this.runGlueStage(question, revision);
    const codeOutput = await this.runCodeStage(outline, revision);
    const copy = await this.runCopyStage(question, outline, revision);
    return this.assemble(outline, codeOutput, copy);
  }

  private reviseSuffix(revision?: string): string {
    return revision?.trim()
      ? `\n\nIMPORTANT — the operator requested this revision; apply it: "${revision.trim()}"`
      : "";
  }

  private async runGlueStage(question: string, revision?: string): Promise<Outline> {
    const prompt = `You are a concise technical content planner.

Given the developer question below, select the best template and outline the answer as a short-form video script.

Templates:
- "60-second-concept": Explain a core programming concept
- "fix-this-error": Show how to diagnose and fix a specific error
- "x-in-3-steps": Break a task into exactly 3 clear steps
- "dont-do-this": Show a common mistake and the correct approach
- "tool-of-the-week": Introduce a useful developer tool

Question: ${question}

Return a templateId and an array of steps (2–5 steps). For each step include:
- text: the spoken beat for that step
- needsCode: true if showing a code snippet would help
- language: (only when needsCode is true) one of javascript, typescript, python${this.reviseSuffix(revision)}`;

    return this.client.generateObject("glue", prompt, OutlineSchema);
  }

  private async runCodeStage(outline: Outline, revision?: string): Promise<CodeStageOutput | null> {
    const codeSteps = outline.steps
      .map((step, index) => ({ ...step, index }))
      .filter((step) => step.needsCode);

    if (codeSteps.length === 0) return null;

    const stepDescriptions = codeSteps
      .map((s) => `Step ${s.index} (${s.language ?? "javascript"}): ${s.text}`)
      .join("\n");

    const prompt = `You are an expert coding educator writing code snippets for a short-form video. Each snippet is EXECUTED in a sandbox to verify it works, so it MUST be COMPLETE and SELF-CONTAINED.

Hard rules for EVERY snippet:
- It must run with ZERO errors via \`node\` (javascript/typescript) or \`python3\` (python).
- Define ALL sample data and variables it uses — never reference an undefined symbol (e.g. don't use a bare \`user\` without first defining it).
- End with a console.log / print that demonstrates the result, so running it produces visible output.
- Prioritise being runnable over being short (aim under ~18 lines, but correctness first).

${stepDescriptions}

Return snippets array with: stepIndex (the original step index), code (the COMPLETE runnable snippet), language.${this.reviseSuffix(revision)}`;

    return this.client.generateObject("code", prompt, CodeStageOutputSchema);
  }

  private async runCopyStage(
    question: string,
    outline: Outline,
    revision?: string,
  ): Promise<CopyStageOutput> {
    const templateId: TemplateId = outline.templateId;
    const stepSummary = outline.steps.map((s, i) => `Step ${i}: ${s.text}`).join("\n");

    const prompt = `You are writing copy for "Coddy", an enthusiastic, clear, and encouraging retro-pixel-robot coding buddy (the mascot of the CodeWithQuirk channel). Clarity beats jokes; never snarky.

Original question: ${question}
Template: ${templateId}
Content beats:
${stepSummary}

Write:
- hook: A punchy 1-sentence opening that grabs attention
- voiceoverText: Full voiceover script (spoken, friendly, ~60–90 words)
- captionsText: Condensed captions version (~30 words)
- socialCaption: Instagram/Facebook caption with emoji (~25 words)
- hashtags: 5–8 relevant hashtags (no # prefix)
- coverSpec: title (short, bold) and optional subtitle
- mascotCues: mascot animation states mapped to steps. Use atStep:-1 for intro, atStep equal to the last step index for outro. Valid states: idle, talking, intro, outro, happy, excited, sad, shy, cry, sleep, damage. Use "excited" at the payoff beat, "damage" for fix-this-error problems, "intro" at start, "outro" at end, "talking" for normal beats, "happy" for success moments.${this.reviseSuffix(revision)}`;

    return this.client.generateObject("copy", prompt, CopyStageOutputSchema);
  }

  private assemble(
    outline: Outline,
    codeOutput: CodeStageOutput | null,
    copy: CopyStageOutput,
  ): ScriptPackage {
    const snippetMap = new Map<
      number,
      { code: string; language: "javascript" | "typescript" | "python" }
    >();
    if (codeOutput) {
      for (const snippet of codeOutput.snippets) {
        snippetMap.set(snippet.stepIndex, {
          code: snippet.code,
          language: snippet.language,
        });
      }
    }

    const bodySteps = outline.steps.map((step, index) => {
      const snippet = snippetMap.get(index);
      if (snippet) {
        return { text: step.text, code: snippet.code, language: snippet.language };
      }
      return { text: step.text };
    });

    const coverSpec = copy.coverSpec.subtitle
      ? { title: copy.coverSpec.title, subtitle: copy.coverSpec.subtitle }
      : { title: copy.coverSpec.title };

    return ScriptPackageSchema.parse({
      templateId: outline.templateId,
      hook: copy.hook,
      bodySteps,
      voiceoverText: copy.voiceoverText,
      captionsText: copy.captionsText,
      socialCaption: copy.socialCaption,
      hashtags: copy.hashtags,
      coverSpec,
      mascotCues: copy.mascotCues,
    });
  }
}
