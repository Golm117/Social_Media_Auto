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

export interface GenerateOptions {
  /** Topic language hint (e.g. the auto-topic rotation tag) — steers snippet language. */
  language?: string;
  /** Operator revise instruction, applied on regeneration. */
  revision?: string;
}

export interface ContentGenerator {
  generate(question: string, opts?: GenerateOptions): Promise<ScriptPackage>;
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
    // OpenRouter intermittently returns a 200 whose body the SDK can't parse
    // ("AI_APICallError: Failed to process successful response"), which the SDK
    // treats as non-retryable — a single hiccup would otherwise kill the whole
    // (often unattended) draft. Retry transient failures; the next call is clean.
    return retryTransient(async () => {
      // Cap output tokens — OpenRouter reserves credits for the full max_tokens, and the
      // default (64k) is both wasteful and can exceed a low account balance.
      const result = await generateObject({ model, schema, prompt, maxOutputTokens: 4000 });
      return result.object;
    });
  }
}

/**
 * Whether a model-call error is a transient API hiccup worth retrying. Schema /
 * validation failures are deterministic (same prompt → same bad output), so they
 * are NOT retried — only API/network-level errors that typically clear on retry.
 */
export function isTransientModelError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  const name = e?.name ?? "";
  const msg = String(e?.message ?? "");
  if (name === "AI_TypeValidationError" || name === "AI_NoObjectGeneratedError") return false;
  return (
    name === "AI_APICallError" ||
    name === "AI_RetryError" ||
    /failed to process successful response/i.test(msg) ||
    /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network|timeout/i.test(msg)
  );
}

/** Retry `fn` on transient model errors with linear backoff. `sleep` is injectable for tests. */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const attempts = opts?.attempts ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 500;
  const sleep = opts?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt >= attempts || !isTransientModelError(e)) throw e;
      await sleep(baseDelayMs * attempt);
    }
  }
  throw lastErr;
}

// ─── Pipeline schemas ──────────────────────────────────────────────────────

const CodeLanguageSchema = z.enum(["javascript", "typescript", "python", "sql", "css"]);
type SnippetLanguage = z.infer<typeof CodeLanguageSchema>;

// Per-language rule injected into the code-stage prompt. js/ts/python/sql are
// executed in a sandbox; css is shown on screen only.
const RUN_RULE: Record<SnippetLanguage, string> = {
  javascript: "runs with ZERO errors via `node`; END with a console.log that prints the result.",
  typescript: "runs with ZERO errors via `node` (types are stripped); END with a console.log.",
  python: "runs with ZERO errors via `python3`; END with a print() that shows the result.",
  sql: "runs against an in-memory SQLite database — be self-contained: CREATE TABLE, INSERT a few sample rows, then END with a SELECT that returns rows. Use only SQLite-compatible syntax.",
  css: "is shown on screen only (NOT executed) — write valid, self-contained CSS that illustrates the concept. No run/print needed.",
};

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

  async generate(question: string, opts?: GenerateOptions): Promise<ScriptPackage> {
    const language = opts?.language?.trim().toLowerCase() || undefined;
    const revision = opts?.revision;
    const outline = await this.runGlueStage(question, language, revision);
    const codeOutput = await this.runCodeStage(outline, language, revision);
    const copy = await this.runCopyStage(question, outline, revision);
    return this.assemble(outline, codeOutput, copy);
  }

  private reviseSuffix(revision?: string): string {
    return revision?.trim()
      ? `\n\nIMPORTANT — the operator requested this revision; apply it: "${revision.trim()}"`
      : "";
  }

  /** Instruction binding snippet language to the topic, when a hint is known. */
  private languageDirective(language?: string): string {
    if (!language) return "";
    return `\n\nThis topic is about ${language}. Every code snippet in this video MUST use language: ${language} — do not switch languages.`;
  }

  private async runGlueStage(
    question: string,
    language?: string,
    revision?: string,
  ): Promise<Outline> {
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
- language: (only when needsCode is true) one of javascript, typescript, python, sql, css${this.languageDirective(language)}${this.reviseSuffix(revision)}`;

    return this.client.generateObject("glue", prompt, OutlineSchema);
  }

  private async runCodeStage(
    outline: Outline,
    language?: string,
    revision?: string,
  ): Promise<CodeStageOutput | null> {
    const codeSteps = outline.steps
      .map((step, index) => ({ ...step, index }))
      .filter((step) => step.needsCode);

    if (codeSteps.length === 0) return null;

    const stepDescriptions = codeSteps
      .map((s) => `Step ${s.index} (${s.language ?? language ?? "javascript"}): ${s.text}`)
      .join("\n");

    // Only surface the rules for languages actually in play, led by the topic hint.
    const langsInPlay = new Set<SnippetLanguage>(
      codeSteps.map((s) => s.language).filter((l): l is SnippetLanguage => l != null),
    );
    if (language && language in RUN_RULE) langsInPlay.add(language as SnippetLanguage);
    if (langsInPlay.size === 0) langsInPlay.add("javascript");
    const ruleLines = [...langsInPlay].map((l) => `- ${l}: it ${RUN_RULE[l]}`).join("\n");

    const prompt = `You are an expert coding educator writing code snippets for a short-form video. Each snippet MUST be COMPLETE and SELF-CONTAINED. js/ts/python/sql snippets are EXECUTED in a sandbox to verify they work; css is shown on screen only.

Per-language rules:
${ruleLines}

Hard rules for EVERY snippet:
- Each snippet runs as ONE standalone file with NO sibling files. NEVER import or require a local/relative path (no \`import x from "./math.js"\`, no \`require("./utils")\`, no SQL \`.read\`/ATTACH of another file) — that file will not exist and the run fails. Inline everything into this single snippet. Importing language built-ins / the standard library (e.g. \`node:fs\`, Python's \`math\`) is fine.
- To demonstrate a multi-file idea (modules, imports/exports), show it WITHIN one file — define the "module" code and use it in the same snippet; a \`// in math.js\` comment is fine, an actual cross-file import is not.
- Define ALL sample data and variables it uses — never reference an undefined symbol (e.g. don't use a bare \`user\` without first defining it).
- Prioritise being correct/runnable over being short (aim under ~18 lines, but correctness first).

${stepDescriptions}

Return snippets array with: stepIndex (the original step index), code (the COMPLETE snippet), language.${this.languageDirective(language)}${this.reviseSuffix(revision)}`;

    return this.client.generateObject("code", prompt, CodeStageOutputSchema);
  }

  private async runCopyStage(
    question: string,
    outline: Outline,
    revision?: string,
  ): Promise<CopyStageOutput> {
    const templateId: TemplateId = outline.templateId;
    const stepSummary = outline.steps.map((s, i) => `Step ${i}: ${s.text}`).join("\n");

    const prompt = `You are writing copy for "Coddy", a warm and patient coding TEACHER — the friendly retro-pixel-robot mascot of the CodeWithQuirk channel. Teach the way the best beginner-friendly instructor would: encouraging and plain-spoken, speak directly to the viewer as "you", briefly explain WHY something works (not just what to type), and use a simple everyday analogy when it genuinely aids understanding. Calm, clear and supportive — never rushed, snarky, or jargon-heavy.

Original question: ${question}
Template: ${templateId}
Content beats:
${stepSummary}

Write:
- hook: A punchy 1-sentence opening that grabs attention
- voiceoverText: Full voiceover script spoken like a patient, encouraging teacher walking a beginner through it — explain the reasoning warmly and simply, in a natural teaching rhythm (~70–100 words). CRITICAL — this is read aloud by a text-to-speech voice, so it MUST be plain spoken English with NO code and NO symbols. NEVER read a code line aloud and never include characters like = < > { } ( ) ; ++ && ?. => or a dotted path. Describe code in words instead: say "increment i by one" (not "i++"), "i is less than five" (not "i < 5"), "use optional chaining" (not "?."), "curly braces" (not "{}"), "the user dot profile property" (not "user.profile"). The code is shown on screen — the voiceover just explains it conversationally. EMOTION: you MAY add occasional ElevenLabs v3 audio tags in square brackets to shape a warm teacher delivery — ONLY from this exact set: [warmly] [encouraging] [thoughtfully] [reassuring] [excited] [curious] [calm] — placed at the start of a sentence or clause and used sparingly (about 2–4 across the whole script). These approved tags are the ONLY square brackets allowed; still no code symbols.
- captionsText: Condensed captions version (~30 words)
- socialCaption: Instagram/Facebook caption with emoji (~25 words)
- hashtags: 6–9 hashtags (no # prefix), as a STRATEGIC MIX for discovery: 2–3 broad/high-reach (e.g. coding, programming, webdev), 2–3 niche & specific to THIS topic (e.g. javascriptloops, asyncawait, optionalchaining), 1–2 audience tags (e.g. learntocode, codenewbie, 100daysofcode). Keep them real and relevant — no spammy, banned, or single-word-generic filler. (The branded #CodeWithQuirk is added automatically, no need to include it.)
- coverSpec: title (short, bold) and optional subtitle
- mascotCues: mascot animation states mapped to steps. Use atStep:-1 for intro, atStep equal to the last step index for outro. Valid states: idle, talking, intro, outro, happy, excited, sad, shy, cry, sleep, damage. Use "excited" at the payoff beat, "damage" for fix-this-error problems, "intro" at start, "outro" at end, "talking" for normal beats, "happy" for success moments.${this.reviseSuffix(revision)}`;

    return this.client.generateObject("copy", prompt, CopyStageOutputSchema);
  }

  private assemble(
    outline: Outline,
    codeOutput: CodeStageOutput | null,
    copy: CopyStageOutput,
  ): ScriptPackage {
    const snippetMap = new Map<number, { code: string; language: SnippetLanguage }>();
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
