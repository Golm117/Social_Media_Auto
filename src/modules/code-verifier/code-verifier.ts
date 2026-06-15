import { Sandbox as E2BSandboxBase } from "e2b";
import ts from "typescript";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Languages the sandbox can actually execute to verify. css is NOT here — it is
 *  display-only and never reaches the verifier (the runtime filters it out). */
export type CodeLanguage = "javascript" | "typescript" | "python" | "sql";

const RUNNABLE_LANGUAGES = new Set<string>(["javascript", "typescript", "python", "sql"]);

/** True when a snippet language can be run in the sandbox (excludes display-only css). */
export function isRunnableLanguage(language: string): language is CodeLanguage {
  return RUNNABLE_LANGUAGES.has(language);
}

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

// ─── E2BSandbox (real adapter) ───────────────────────────────────────────────
// The E2B `base` image ships Node 20 (can't run .ts) and no tsx, and we run with
// internet disabled — so `npx tsx` can neither find nor fetch tsx and hangs until
// E2B's request deadline fires. Instead we strip TypeScript types locally and run
// the resulting JS with plain `node`; the sandbox only ever executes JS + Python.

/** Fail fast rather than hang to E2B's deadline if provisioning or a run stalls. */
const SANDBOX_REQUEST_TIMEOUT_MS = 30_000;
const COMMAND_TIMEOUT_MS = 30_000;

/** Strip TS types → JS so the sandbox's older Node can run it without tsx/network. */
export function stripTypes(code: string): string {
  return ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
}

/** The base image has no `sqlite3` CLI, but Python's `sqlite3` module is present.
 *  Wrap the SQL in a Python harness that runs each statement against an in-memory
 *  DB and prints rows from any that return them. The SQL is base64-embedded to
 *  sidestep all shell/quote escaping; a SQL error raises → non-zero exit. */
export function sqlRunner(code: string): string {
  const b64 = Buffer.from(code, "utf8").toString("base64");
  return `import sqlite3, base64
sql = base64.b64decode("${b64}").decode("utf-8")
cur = sqlite3.connect(":memory:").cursor()
buf = ""
def run(stmt):
    s = stmt.strip()
    if not s:
        return
    cur.execute(s)
    for r in cur.fetchall():
        print("|".join(str(c) for c in r))
for line in sql.splitlines(keepends=True):
    buf += line
    if sqlite3.complete_statement(buf):
        run(buf)
        buf = ""
run(buf)
`;
}

interface PreparedRun {
  ext: string;
  contents: string;
  command: (path: string) => string;
}

function prepareRun(language: CodeLanguage, code: string): PreparedRun {
  switch (language) {
    case "python":
      return { ext: "py", contents: code, command: (p) => `python3 ${p}` };
    case "javascript":
      return { ext: "mjs", contents: code, command: (p) => `node ${p}` };
    case "typescript":
      return { ext: "mjs", contents: stripTypes(code), command: (p) => `node ${p}` };
    case "sql":
      return { ext: "py", contents: sqlRunner(code), command: (p) => `python3 ${p}` };
  }
}

export class E2BSandbox implements Sandbox {
  constructor(private readonly config: { apiKey: string }) {}

  async run(language: CodeLanguage, code: string): Promise<SandboxRunResult> {
    const { ext, contents, command } = prepareRun(language, code);
    const sbx = await E2BSandboxBase.create({
      apiKey: this.config.apiKey,
      allowInternetAccess: false,
      requestTimeoutMs: SANDBOX_REQUEST_TIMEOUT_MS,
    });
    try {
      const tmpPath = `/tmp/snippet.${ext}`;
      await sbx.files.write(tmpPath, contents);
      try {
        const result = await sbx.commands.run(command(tmpPath), {
          timeoutMs: COMMAND_TIMEOUT_MS,
        });
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
