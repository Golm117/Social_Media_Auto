import { describe, expect, it } from "vitest";
import type { CodeLanguage, SandboxRunResult } from "./code-verifier.js";
import { DefaultCodeVerifier, allPassed, failureSummaries, stripTypes } from "./code-verifier.js";
import type { Sandbox } from "./code-verifier.js";

// ─── MockSandbox ─────────────────────────────────────────────────────────────

interface RunCall {
  language: CodeLanguage;
  code: string;
}

class MockSandbox implements Sandbox {
  readonly calls: RunCall[] = [];
  private readonly results: SandboxRunResult[];

  constructor(results: SandboxRunResult[]) {
    this.results = results;
  }

  async run(language: CodeLanguage, code: string): Promise<SandboxRunResult> {
    const index = this.calls.length;
    this.calls.push({ language, code });
    const result = this.results[index];
    if (result === undefined) {
      throw new Error(`MockSandbox: no result configured for call index ${index}`);
    }
    return result;
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const OK_RESULT: SandboxRunResult = { exitCode: 0, stdout: "ok", stderr: "" };
const FAIL_RESULT: SandboxRunResult = {
  exitCode: 1,
  stdout: "",
  stderr: "SyntaxError: Unexpected token",
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("DefaultCodeVerifier — good snippet", () => {
  it("maps exitCode 0 to ok:true and captures stdout", async () => {
    const sandbox = new MockSandbox([OK_RESULT]);
    const verifier = new DefaultCodeVerifier(sandbox);

    const result = await verifier.verify([{ code: "console.log('ok')", language: "javascript" }]);

    expect(result).toHaveLength(1);
    expect(result[0]?.ok).toBe(true);
    expect(result[0]?.stdout).toBe("ok");
    expect(result[0]?.stderr).toBe("");
    expect(result[0]?.snippetIndex).toBe(0);
  });
});

describe("DefaultCodeVerifier — bad snippet", () => {
  it("maps non-zero exit to ok:false and captures stderr", async () => {
    const sandbox = new MockSandbox([FAIL_RESULT]);
    const verifier = new DefaultCodeVerifier(sandbox);

    const result = await verifier.verify([{ code: "syntax error !!!", language: "python" }]);

    expect(result).toHaveLength(1);
    expect(result[0]?.ok).toBe(false);
    expect(result[0]?.stderr).toBe("SyntaxError: Unexpected token");
    expect(result[0]?.stdout).toBe("");
    expect(result[0]?.snippetIndex).toBe(0);
  });
});

describe("DefaultCodeVerifier — multiple snippets (mixed)", () => {
  it("returns 3 items with correct snippetIndex and independent ok values", async () => {
    const sandbox = new MockSandbox([OK_RESULT, FAIL_RESULT, OK_RESULT]);
    const verifier = new DefaultCodeVerifier(sandbox);

    const result = await verifier.verify([
      { code: "print('a')", language: "python" },
      { code: "syntax error !!!", language: "python" },
      { code: "print('c')", language: "python" },
    ]);

    expect(result).toHaveLength(3);
    expect(result[0]?.snippetIndex).toBe(0);
    expect(result[0]?.ok).toBe(true);
    expect(result[1]?.snippetIndex).toBe(1);
    expect(result[1]?.ok).toBe(false);
    expect(result[2]?.snippetIndex).toBe(2);
    expect(result[2]?.ok).toBe(true);
  });
});

describe("DefaultCodeVerifier — language routing", () => {
  it("passes the declared language of each snippet to the sandbox run call", async () => {
    const sandbox = new MockSandbox([OK_RESULT, OK_RESULT, OK_RESULT]);
    const verifier = new DefaultCodeVerifier(sandbox);

    await verifier.verify([
      { code: "console.log(1)", language: "javascript" },
      { code: "print(1)", language: "python" },
      { code: "const x: number = 1", language: "typescript" },
    ]);

    expect(sandbox.calls[0]?.language).toBe("javascript");
    expect(sandbox.calls[1]?.language).toBe("python");
    expect(sandbox.calls[2]?.language).toBe("typescript");
  });
});

describe("DefaultCodeVerifier — empty input", () => {
  it("returns [] and never calls the sandbox", async () => {
    const sandbox = new MockSandbox([]);
    const verifier = new DefaultCodeVerifier(sandbox);

    const result = await verifier.verify([]);

    expect(result).toEqual([]);
    expect(sandbox.calls).toHaveLength(0);
  });
});

describe("stripTypes — TypeScript → runnable JS", () => {
  it("removes type annotations so older Node can run it without tsx", () => {
    const js = stripTypes("const x: number = 41;\nconsole.log('ts-ran', x + 1);");
    // the annotation is gone, the runnable logic survives
    expect(js).not.toContain(": number");
    expect(js).toContain("console.log");
    expect(js).toContain("x + 1");
  });

  it("strips an interface + typed function down to plain JS", () => {
    const js = stripTypes(
      "interface P { n: string }\nfunction hi(p: P): string { return `hi ${p.n}`; }\nconsole.log(hi({ n: 'x' }));",
    );
    expect(js).not.toContain("interface");
    expect(js).not.toContain(": string");
    expect(js).not.toContain(": P");
    expect(js).toContain("function hi(p)");
  });
});

describe("allPassed", () => {
  it("returns true when every item is ok", () => {
    const result = [
      { snippetIndex: 0, ok: true, stdout: "a", stderr: "" },
      { snippetIndex: 1, ok: true, stdout: "b", stderr: "" },
    ];
    expect(allPassed(result)).toBe(true);
  });

  it("returns false when any item failed", () => {
    const result = [
      { snippetIndex: 0, ok: true, stdout: "a", stderr: "" },
      { snippetIndex: 1, ok: false, stdout: "", stderr: "err" },
    ];
    expect(allPassed(result)).toBe(false);
  });

  it("returns true for an empty result (vacuous)", () => {
    expect(allPassed([])).toBe(true);
  });
});

describe("failureSummaries", () => {
  it("returns one string per failed item containing snippetIndex and stderr", () => {
    const result = [
      { snippetIndex: 0, ok: false, stdout: "", stderr: "ReferenceError: x is not defined" },
      { snippetIndex: 1, ok: true, stdout: "ok", stderr: "" },
      { snippetIndex: 2, ok: false, stdout: "", stderr: "SyntaxError: unexpected EOF" },
    ];
    const summaries = failureSummaries(result);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toContain("0");
    expect(summaries[0]).toContain("ReferenceError: x is not defined");
    expect(summaries[1]).toContain("2");
    expect(summaries[1]).toContain("SyntaxError: unexpected EOF");
  });

  it("returns empty array when all passed", () => {
    const result = [
      { snippetIndex: 0, ok: true, stdout: "ok", stderr: "" },
      { snippetIndex: 1, ok: true, stdout: "ok", stderr: "" },
    ];
    expect(failureSummaries(result)).toEqual([]);
  });

  it("uses 'non-zero exit' fallback when stderr is empty on a failure", () => {
    const result = [{ snippetIndex: 3, ok: false, stdout: "", stderr: "" }];
    const summaries = failureSummaries(result);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain("3");
    expect(summaries[0]).toContain("non-zero exit");
  });
});
