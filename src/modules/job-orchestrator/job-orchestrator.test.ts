import { describe, expect, it } from "vitest";
import type { Job, JobState } from "../../domain/job.js";
import type { ScriptPackage } from "../../domain/script-package.js";
import { DefaultJobOrchestrator, IllegalTransitionError, advance } from "./job-orchestrator.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeJob(state: JobState, overrides: Partial<Job> = {}): Job {
  return {
    id: "test-job-1",
    question: "What is a closure?",
    state,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const PKG_WITH_CODE: ScriptPackage = {
  templateId: "60-second-concept",
  hook: "Closures are everywhere",
  bodySteps: [
    {
      text: "A closure captures its lexical scope",
      code: "const fn = () => x;",
      language: "javascript",
    },
    { text: "This runs after" },
  ],
  voiceoverText: "Let me explain closures.",
  captionsText: "closures explained",
  socialCaption: "Closures in 60s",
  hashtags: ["js"],
  coverSpec: { title: "Closures" },
  mascotCues: [{ state: "intro", atStep: -1 }],
};

const PKG_NO_CODE: ScriptPackage = {
  ...PKG_WITH_CODE,
  bodySteps: [{ text: "A closure captures its lexical scope" }, { text: "No code here either" }],
};

// ─── Transition table ──────────────────────────────────────────────────────

describe("advance — transition table", () => {
  it("draft + QuestionSubmitted → generating, [NotifyOperator{generating}, GenerateContent]", () => {
    const result = advance(makeJob("draft"), { type: "QuestionSubmitted" });
    expect(result.state).toBe("generating");
    expect(result.intents).toEqual([
      { type: "NotifyOperator", kind: "generating" },
      { type: "GenerateContent" },
    ]);
  });

  it("generating + ContentGenerated (with code) → verifying, [NotifyOperator{verifying}, VerifyCode]", () => {
    const result = advance(makeJob("generating"), {
      type: "ContentGenerated",
      scriptPackage: PKG_WITH_CODE,
    });
    expect(result.state).toBe("verifying");
    expect(result.intents).toEqual([
      { type: "NotifyOperator", kind: "verifying" },
      { type: "VerifyCode" },
    ]);
  });

  it("generating + ContentGenerated (no code) → rendering, [NotifyOperator{rendering}, RenderVideo]", () => {
    const result = advance(makeJob("generating"), {
      type: "ContentGenerated",
      scriptPackage: PKG_NO_CODE,
    });
    expect(result.state).toBe("rendering");
    expect(result.intents).toEqual([
      { type: "NotifyOperator", kind: "rendering" },
      { type: "RenderVideo" },
    ]);
  });

  it("generating + StageFailed → failed, [NotifyOperator{error}]", () => {
    const result = advance(makeJob("generating"), {
      type: "StageFailed",
      stage: "generating",
      error: "LLM timeout",
    });
    expect(result.state).toBe("failed");
    expect(result.intents).toEqual([
      { type: "NotifyOperator", kind: "error", detail: "LLM timeout" },
    ]);
  });

  it("verifying + CodeVerified → rendering, [NotifyOperator{rendering}, RenderVideo]", () => {
    const result = advance(makeJob("verifying"), { type: "CodeVerified" });
    expect(result.state).toBe("rendering");
    expect(result.intents).toEqual([
      { type: "NotifyOperator", kind: "rendering" },
      { type: "RenderVideo" },
    ]);
  });

  it("verifying + CodeVerificationFailed → review, [NotifyOperator{verification_failed, detail}]", () => {
    const result = advance(makeJob("verifying"), {
      type: "CodeVerificationFailed",
      failures: ["SyntaxError on line 3", "Undefined variable"],
    });
    expect(result.state).toBe("review");
    expect(result.intents).toHaveLength(1);
    const notify = result.intents[0];
    expect(notify?.type).toBe("NotifyOperator");
    if (notify?.type === "NotifyOperator") {
      expect(notify.kind).toBe("verification_failed");
      expect(notify.detail).toContain("SyntaxError on line 3");
      expect(notify.detail).toContain("Undefined variable");
    }
  });

  it("verifying + StageFailed → failed, [NotifyOperator{error}]", () => {
    const result = advance(makeJob("verifying"), {
      type: "StageFailed",
      stage: "verifying",
      error: "verifier crashed",
    });
    expect(result.state).toBe("failed");
    expect(result.intents).toEqual([
      { type: "NotifyOperator", kind: "error", detail: "verifier crashed" },
    ]);
  });

  it("rendering + RenderCompleted → review, [SendForApproval]", () => {
    const result = advance(makeJob("rendering"), {
      type: "RenderCompleted",
      mediaPath: "/tmp/video.mp4",
    });
    expect(result.state).toBe("review");
    expect(result.intents).toEqual([{ type: "SendForApproval" }]);
  });

  it("rendering + StageFailed → failed, [NotifyOperator{error}]", () => {
    const result = advance(makeJob("rendering"), {
      type: "StageFailed",
      stage: "rendering",
      error: "ffmpeg OOM",
    });
    expect(result.state).toBe("failed");
    expect(result.intents).toEqual([
      { type: "NotifyOperator", kind: "error", detail: "ffmpeg OOM" },
    ]);
  });

  it("review + Approved → approved, []", () => {
    const result = advance(makeJob("review"), { type: "Approved" });
    expect(result.state).toBe("approved");
    expect(result.intents).toEqual([]);
  });

  it("review + ReviseRequested → revising, [GenerateContent]", () => {
    const result = advance(makeJob("review"), {
      type: "ReviseRequested",
      instructions: "Make it funnier",
    });
    expect(result.state).toBe("revising");
    expect(result.intents).toEqual([{ type: "GenerateContent" }]);
  });

  it("review + Rejected → rejected, [Cleanup]", () => {
    const result = advance(makeJob("review"), { type: "Rejected" });
    expect(result.state).toBe("rejected");
    expect(result.intents).toEqual([{ type: "Cleanup" }]);
  });

  it("revising + ContentGenerated (with code) → verifying, [NotifyOperator{verifying}, VerifyCode]", () => {
    const result = advance(makeJob("revising"), {
      type: "ContentGenerated",
      scriptPackage: PKG_WITH_CODE,
    });
    expect(result.state).toBe("verifying");
    expect(result.intents).toEqual([
      { type: "NotifyOperator", kind: "verifying" },
      { type: "VerifyCode" },
    ]);
  });

  it("revising + ContentGenerated (no code) → rendering, [NotifyOperator{rendering}, RenderVideo]", () => {
    const result = advance(makeJob("revising"), {
      type: "ContentGenerated",
      scriptPackage: PKG_NO_CODE,
    });
    expect(result.state).toBe("rendering");
    expect(result.intents).toEqual([
      { type: "NotifyOperator", kind: "rendering" },
      { type: "RenderVideo" },
    ]);
  });

  it("revising + StageFailed → failed, [NotifyOperator{error}]", () => {
    const result = advance(makeJob("revising"), {
      type: "StageFailed",
      stage: "revising",
      error: "revision LLM error",
    });
    expect(result.state).toBe("failed");
    expect(result.intents).toEqual([
      { type: "NotifyOperator", kind: "error", detail: "revision LLM error" },
    ]);
  });

  it("approved + PublishRequested → publishing, [PublishPost]", () => {
    const result = advance(makeJob("approved"), { type: "PublishRequested" });
    expect(result.state).toBe("publishing");
    expect(result.intents).toEqual([{ type: "PublishPost" }]);
  });

  it("approved + Rejected → rejected, [Cleanup] (give up on a failing publish)", () => {
    const result = advance(makeJob("approved"), { type: "Rejected" });
    expect(result.state).toBe("rejected");
    expect(result.intents).toEqual([{ type: "Cleanup" }]);
  });

  it("publishing + Published → posted, [NotifyOperator{posted, platforms}, Cleanup]", () => {
    const result = advance(makeJob("publishing"), {
      type: "Published",
      results: [{ platform: "instagram", ok: true }],
    });
    expect(result.state).toBe("posted");
    expect(result.intents).toEqual([
      { type: "NotifyOperator", kind: "posted", detail: "instagram" },
      { type: "Cleanup" },
    ]);
  });

  it("publishing + PublishFailed → approved (retryable), [NotifyOperator{publish_failed}]", () => {
    const result = advance(makeJob("publishing"), {
      type: "PublishFailed",
      results: [{ platform: "facebook", ok: false, error: "rate limited" }],
    });
    expect(result.state).toBe("approved");
    expect(result.intents).toHaveLength(1);
    const notify = result.intents[0];
    expect(notify?.type).toBe("NotifyOperator");
    if (notify?.type === "NotifyOperator") {
      expect(notify.kind).toBe("publish_failed");
      expect(notify.detail).toContain("facebook");
    }
  });

  it("publishing + StageFailed (publisher threw) → approved, [NotifyOperator{publish_failed}]", () => {
    const result = advance(makeJob("publishing"), {
      type: "StageFailed",
      stage: "publishing",
      error: "Telegram down",
    });
    expect(result.state).toBe("approved");
    expect(result.intents).toEqual([
      { type: "NotifyOperator", kind: "publish_failed", detail: "Telegram down" },
    ]);
  });
});

// ─── Branching guards ──────────────────────────────────────────────────────

describe("advance — code-presence branch", () => {
  it("routes to verifying when at least one step has code", () => {
    const pkg: ScriptPackage = {
      ...PKG_NO_CODE,
      bodySteps: [
        { text: "Step without code" },
        { text: "Step with code", code: "x = 1;", language: "python" },
      ],
    };
    const result = advance(makeJob("generating"), { type: "ContentGenerated", scriptPackage: pkg });
    expect(result.state).toBe("verifying");
  });

  it("routes to rendering when no steps have code (code is undefined on all)", () => {
    const pkg: ScriptPackage = {
      ...PKG_NO_CODE,
      bodySteps: [{ text: "Step A" }, { text: "Step B" }],
    };
    const result = advance(makeJob("generating"), { type: "ContentGenerated", scriptPackage: pkg });
    expect(result.state).toBe("rendering");
  });
});

// ─── Revise loop ───────────────────────────────────────────────────────────

describe("advance — revise loop", () => {
  it("review + ReviseRequested → revising; then ContentGenerated(code) → verifying", () => {
    const job = makeJob("review");
    const r1 = advance(job, { type: "ReviseRequested", instructions: "add more examples" });
    expect(r1.state).toBe("revising");

    const r2 = advance(makeJob("revising"), {
      type: "ContentGenerated",
      scriptPackage: PKG_WITH_CODE,
    });
    expect(r2.state).toBe("verifying");
    expect(r2.intents).toEqual([
      { type: "NotifyOperator", kind: "verifying" },
      { type: "VerifyCode" },
    ]);
  });

  it("review + ReviseRequested → revising; then ContentGenerated(no code) → rendering", () => {
    const r1 = advance(makeJob("review"), {
      type: "ReviseRequested",
      instructions: "make it simpler",
    });
    expect(r1.state).toBe("revising");

    const r2 = advance(makeJob("revising"), {
      type: "ContentGenerated",
      scriptPackage: PKG_NO_CODE,
    });
    expect(r2.state).toBe("rendering");
    expect(r2.intents).toContainEqual({ type: "RenderVideo" });
  });
});

// ─── Publish path ──────────────────────────────────────────────────────────

describe("advance — full publish path", () => {
  it("approved → PublishRequested → publishing; then Published → posted + Cleanup", () => {
    const r1 = advance(makeJob("approved"), { type: "PublishRequested" });
    expect(r1.state).toBe("publishing");
    expect(r1.intents).toContainEqual({ type: "PublishPost" });

    const r2 = advance(makeJob("publishing"), {
      type: "Published",
      results: [
        { platform: "instagram", ok: true },
        { platform: "facebook", ok: true },
      ],
    });
    expect(r2.state).toBe("posted");
    expect(r2.intents).toContainEqual({ type: "Cleanup" });
    expect(r2.intents).toContainEqual({
      type: "NotifyOperator",
      kind: "posted",
      detail: "instagram + facebook",
    });
  });

  it("publishing + PublishFailed falls back to approved, ready to retry", () => {
    const result = advance(makeJob("publishing"), {
      type: "PublishFailed",
      results: [
        { platform: "instagram", ok: false, error: "network error" },
        { platform: "facebook", ok: true },
      ],
    });
    expect(result.state).toBe("approved");
    const notify = result.intents[0];
    if (notify?.type === "NotifyOperator") {
      expect(notify.kind).toBe("publish_failed");
      expect(notify.detail).toContain("instagram");
    }
  });
});

// ─── Illegal transitions ───────────────────────────────────────────────────

describe("advance — illegal transitions throw IllegalTransitionError", () => {
  it("terminal state posted + Approved throws", () => {
    expect(() => advance(makeJob("posted"), { type: "Approved" })).toThrow(IllegalTransitionError);
  });

  it("terminal state rejected + QuestionSubmitted throws", () => {
    expect(() => advance(makeJob("rejected"), { type: "QuestionSubmitted" })).toThrow(
      IllegalTransitionError,
    );
  });

  it("terminal state failed + ContentGenerated throws", () => {
    expect(() =>
      advance(makeJob("failed"), { type: "ContentGenerated", scriptPackage: PKG_WITH_CODE }),
    ).toThrow(IllegalTransitionError);
  });

  it("draft + Approved (nonsensical pair) throws", () => {
    expect(() => advance(makeJob("draft"), { type: "Approved" })).toThrow(IllegalTransitionError);
  });

  it("rendering + Approved throws", () => {
    expect(() => advance(makeJob("rendering"), { type: "Approved" })).toThrow(
      IllegalTransitionError,
    );
  });

  it("error message names the offending state and event type", () => {
    let err: unknown;
    try {
      advance(makeJob("posted"), { type: "Approved" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(IllegalTransitionError);
    expect((err as Error).message).toContain("posted");
    expect((err as Error).message).toContain("Approved");
  });
});

// ─── Immutability ──────────────────────────────────────────────────────────

describe("advance — does NOT mutate the input job", () => {
  it("draft job state unchanged after advance", () => {
    const job = makeJob("draft");
    const original = { ...job };
    advance(job, { type: "QuestionSubmitted" });
    expect(job).toEqual(original);
  });

  it("review job state unchanged after advance", () => {
    const job = makeJob("review");
    const original = { ...job };
    advance(job, { type: "Approved" });
    expect(job).toEqual(original);
  });
});

// ─── DefaultJobOrchestrator (interface impl) ───────────────────────────────

describe("DefaultJobOrchestrator", () => {
  it("delegates to the pure advance function", () => {
    const orch = new DefaultJobOrchestrator();
    const result = orch.advance(makeJob("draft"), { type: "QuestionSubmitted" });
    expect(result.state).toBe("generating");
    expect(result.intents).toContainEqual({ type: "GenerateContent" });
  });

  it("throws IllegalTransitionError on illegal transitions", () => {
    const orch = new DefaultJobOrchestrator();
    expect(() => orch.advance(makeJob("posted"), { type: "Rejected" })).toThrow(
      IllegalTransitionError,
    );
  });
});
