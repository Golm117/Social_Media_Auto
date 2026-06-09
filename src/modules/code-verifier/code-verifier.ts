import { Sandbox as E2BSandboxBase } from "e2b";

// ─── Types ──────────────────────────────────────────────────────────────────

export type CodeLanguage = "javascript" | "typescript" | "python";

export interface SandboxRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Injectable boundary. Real impl calls E2B; tests mock it. */
export interface Sandbox {
  run(language: CodeLanguage, code: string): Promise<SandboxRunResult>;
}

export interface Snippet {
  code: string;
  language: CodeLanguage;
}

export interface VerificationResultItem {
  snippetIndex: number;
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type VerificationResult = VerificationResultItem[];

export interface CodeVerifier {
  verify(snippets: Snippet[]): Promise<VerificationResult>;
}

// ─── DefaultCodeVerifier ────────────────────────────────────────────────────

export class DefaultCodeVerifier implements CodeVerifier {
  constructor(private readonly sandbox: Sandbox) {}

  async verify(snippets: Snippet[]): Promise<VerificationResult> {
    const results: VerificationResult = [];
    for (const [i, snippet] of snippets.entries()) {
      const runResult = await this.sandbox.run(snippet.language, snippet.code);
      results.push({
        snippetIndex: i,
        ok: runResult.exitCode === 0,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
      });
    }
    return results;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function allPassed(result: VerificationResult): boolean {
  return result.every((item) => item.ok);
}

export function failureSummaries(result: VerificationResult): string[] {
  return result
    .filter((item) => !item.ok)
    .map((item) => `Snippet ${item.snippetIndex}: ${item.stderr || "non-zero exit"}`);
}

// ─── E2BSandbox (real adapter — NOT network-tested in this slice) ────────────
// Validate end-to-end when E2B_API_KEY is wired in a later integration pass.
// TypeScript execution requires npx/tsx available in the sandbox base image.

const FILE_EXT: Record<CodeLanguage, string> = {
  python: "py",
  javascript: "mjs",
  typescript: "ts",
};

const RUNNER_CMD: Record<CodeLanguage, (path: string) => string> = {
  python: (p) => `python3 ${p}`,
  javascript: (p) => `node ${p}`,
  typescript: (p) => `npx --yes tsx ${p}`,
};

export class E2BSandbox implements Sandbox {
  constructor(private readonly config: { apiKey: string }) {}

  async run(language: CodeLanguage, code: string): Promise<SandboxRunResult> {
    const sbx = await E2BSandboxBase.create({
      apiKey: this.config.apiKey,
      allowInternetAccess: false,
    });
    try {
      const tmpPath = `/tmp/snippet.${FILE_EXT[language]}`;
      await sbx.files.write(tmpPath, code);
      try {
        const result = await sbx.commands.run(RUNNER_CMD[language](tmpPath));
        return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
      } catch (err) {
        // E2B throws CommandExitError on non-zero exit — that's a verification
        // FAILURE, not an adapter error. Surface it as a result.
        const e = err as { exitCode?: number; stdout?: string; stderr?: string };
        if (typeof e.exitCode === "number") {
          return { exitCode: e.exitCode, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
        }
        throw err;
      }
    } finally {
      await sbx.kill();
    }
  }
}
