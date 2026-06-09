import type { Job, JobState } from "../../domain/job.js";
import type { ScriptPackage } from "../../domain/script-package.js";

// ─── Events ────────────────────────────────────────────────────────────────

export type JobEvent =
  | { type: "QuestionSubmitted" }
  | { type: "ContentGenerated"; scriptPackage: ScriptPackage }
  | { type: "CodeVerified" }
  | { type: "CodeVerificationFailed"; failures: string[] }
  | { type: "RenderCompleted"; mediaPath: string }
  | { type: "Approved" }
  | { type: "ReviseRequested"; instructions: string }
  | { type: "Rejected" }
  | { type: "PublishRequested" }
  | {
      type: "Published";
      results: Array<{ platform: "instagram" | "facebook"; ok: boolean; error?: string }>;
    }
  | {
      type: "PublishFailed";
      results: Array<{ platform: "instagram" | "facebook"; ok: boolean; error?: string }>;
    }
  | { type: "StageFailed"; stage: JobState; error: string };

// ─── Intents ───────────────────────────────────────────────────────────────

export type Intent =
  | {
      type: "NotifyOperator";
      kind:
        | "generating"
        | "verifying"
        | "rendering"
        | "verification_failed"
        | "posted"
        | "publish_failed"
        | "error";
      detail?: string;
    }
  | { type: "GenerateContent" }
  | { type: "VerifyCode" }
  | { type: "RenderVideo" }
  | { type: "SendForApproval" }
  | { type: "PublishPost" }
  | { type: "Cleanup" };

// ─── Error ─────────────────────────────────────────────────────────────────

export class IllegalTransitionError extends Error {
  constructor(state: JobState, eventType: string) {
    super(`Illegal transition: state="${state}" does not accept event "${eventType}"`);
    this.name = "IllegalTransitionError";
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function hasCode(scriptPackage: ScriptPackage): boolean {
  return scriptPackage.bodySteps.some((step) => step.code !== undefined);
}

function contentGeneratedResult(scriptPackage: ScriptPackage): {
  state: JobState;
  intents: Intent[];
} {
  if (hasCode(scriptPackage)) {
    return {
      state: "verifying",
      intents: [{ type: "NotifyOperator", kind: "verifying" }, { type: "VerifyCode" }],
    };
  }
  return {
    state: "rendering",
    intents: [{ type: "NotifyOperator", kind: "rendering" }, { type: "RenderVideo" }],
  };
}

// ─── Pure state machine ────────────────────────────────────────────────────

export function advance(job: Job, event: JobEvent): { state: JobState; intents: Intent[] } {
  const { state } = job;

  switch (state) {
    case "draft": {
      if (event.type === "QuestionSubmitted") {
        return {
          state: "generating",
          intents: [{ type: "NotifyOperator", kind: "generating" }, { type: "GenerateContent" }],
        };
      }
      break;
    }

    case "generating": {
      if (event.type === "ContentGenerated") {
        return contentGeneratedResult(event.scriptPackage);
      }
      if (event.type === "StageFailed") {
        return {
          state: "failed",
          intents: [{ type: "NotifyOperator", kind: "error", detail: event.error }],
        };
      }
      break;
    }

    case "verifying": {
      if (event.type === "CodeVerified") {
        return {
          state: "rendering",
          intents: [{ type: "NotifyOperator", kind: "rendering" }, { type: "RenderVideo" }],
        };
      }
      if (event.type === "CodeVerificationFailed") {
        return {
          state: "review",
          intents: [
            {
              type: "NotifyOperator",
              kind: "verification_failed",
              detail: event.failures.join(", "),
            },
          ],
        };
      }
      if (event.type === "StageFailed") {
        return {
          state: "failed",
          intents: [{ type: "NotifyOperator", kind: "error", detail: event.error }],
        };
      }
      break;
    }

    case "rendering": {
      if (event.type === "RenderCompleted") {
        return {
          state: "review",
          intents: [{ type: "SendForApproval" }],
        };
      }
      if (event.type === "StageFailed") {
        return {
          state: "failed",
          intents: [{ type: "NotifyOperator", kind: "error", detail: event.error }],
        };
      }
      break;
    }

    case "review": {
      if (event.type === "Approved") {
        return { state: "approved", intents: [] };
      }
      if (event.type === "ReviseRequested") {
        return {
          state: "revising",
          intents: [{ type: "GenerateContent" }],
        };
      }
      if (event.type === "Rejected") {
        return {
          state: "rejected",
          intents: [{ type: "Cleanup" }],
        };
      }
      break;
    }

    case "revising": {
      if (event.type === "ContentGenerated") {
        return contentGeneratedResult(event.scriptPackage);
      }
      if (event.type === "StageFailed") {
        return {
          state: "failed",
          intents: [{ type: "NotifyOperator", kind: "error", detail: event.error }],
        };
      }
      break;
    }

    case "approved": {
      if (event.type === "PublishRequested") {
        return {
          state: "approved",
          intents: [{ type: "PublishPost" }],
        };
      }
      if (event.type === "Published") {
        return {
          state: "posted",
          intents: [{ type: "NotifyOperator", kind: "posted" }, { type: "Cleanup" }],
        };
      }
      if (event.type === "PublishFailed") {
        const detail = event.results
          .filter((r) => !r.ok)
          .map((r) => `${r.platform}${r.error ? `: ${r.error}` : ""}`)
          .join(", ");
        return {
          state: "approved",
          intents: [{ type: "NotifyOperator", kind: "publish_failed", detail }],
        };
      }
      break;
    }

    // Terminal states — fall through to throw below
    case "posted":
    case "rejected":
    case "failed":
      break;
  }

  throw new IllegalTransitionError(state, event.type);
}

// ─── Interface + concrete impl ─────────────────────────────────────────────

export interface JobOrchestrator {
  advance(job: Job, event: JobEvent): { state: JobState; intents: Intent[] };
}

export class DefaultJobOrchestrator implements JobOrchestrator {
  advance(job: Job, event: JobEvent): { state: JobState; intents: Intent[] } {
    return advance(job, event);
  }
}
