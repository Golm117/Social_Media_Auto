import { describe, expect, it } from "vitest";
import type { Job } from "../domain/job.js";
import type { ScriptPackage } from "../domain/script-package.js";
import type { CodeVerifier } from "../modules/code-verifier/index.js";
import type { ContentGenerator } from "../modules/content-generator/index.js";
import type {
  ActionHandler,
  ConversationGateway,
  OperatorAction,
  QuestionHandler,
} from "../modules/conversation-gateway/index.js";
import { SqliteJobStore } from "../modules/job-store/job-store.js";
import type { MascotSequencer } from "../modules/mascot-sequencer/index.js";
import {
  MockPublisher,
  type PostCaptions,
  type PublishResult,
  type PublishTarget,
  type Publisher,
} from "../modules/publisher/index.js";
import { DefaultScheduler, type SchedulerConfig } from "../modules/scheduler/index.js";
import type { VideoComposer } from "../modules/video-composer/index.js";
import type { VoiceSynthesizer } from "../modules/voice-synthesizer/index.js";
import { Runtime, type RuntimeDeps } from "./runtime.js";

function makeScript(withCode = true): ScriptPackage {
  return {
    templateId: "x-in-3-steps",
    hook: "loops!",
    bodySteps: withCode
      ? [{ text: "for loop", code: "for(;;){}", language: "javascript" }]
      : [{ text: "just talk" }],
    voiceoverText: "here we go",
    captionsText: "loops",
    socialCaption: "loops #js",
    hashtags: ["js"],
    coverSpec: { title: "loops" },
    mascotCues: [{ state: "talking", atStep: 0 }],
  };
}

class RecordingGateway implements ConversationGateway {
  notifications: string[] = [];
  drafts: string[] = [];
  prompts: Array<{ jobId: string; message: string; actions: OperatorAction[] }> = [];
  qh: QuestionHandler = () => {};
  ah: ActionHandler = () => {};
  onQuestion(h: QuestionHandler) {
    this.qh = h;
  }
  onAction(h: ActionHandler) {
    this.ah = h;
  }
  async notify(_job: Job, message: string) {
    this.notifications.push(message);
  }
  async sendDraftForApproval(job: Job) {
    this.drafts.push(job.id);
  }
  async sendActionPrompt(job: Job, message: string, actions: OperatorAction[]) {
    this.prompts.push({ jobId: job.id, message, actions });
  }
}

function makeRuntime<P extends Publisher = MockPublisher>(overrides?: {
  verifier?: CodeVerifier;
  publisher?: P;
}) {
  const store = new SqliteJobStore(":memory:");
  const gateway = new RecordingGateway();
  const publisher = (overrides?.publisher ?? new MockPublisher()) as P;
  const contentGenerator: ContentGenerator = { generate: async () => makeScript() };
  const codeVerifier: CodeVerifier =
    overrides?.verifier ??
    ({
      verify: async (s) => s.map((_, i) => ({ snippetIndex: i, ok: true, stdout: "", stderr: "" })),
    } as CodeVerifier);
  const voice: VoiceSynthesizer = {
    synthesize: async () => ({
      audioPath: "a.mp3",
      timings: [{ word: "x", startMs: 0, endMs: 100 }],
    }),
  };
  const mascot: MascotSequencer = { sequence: async () => ({ trackPath: "t.json" }) };
  const video: VideoComposer = { compose: async () => ({ videoPath: "/tmp/none.mp4" }) };
  const schedulerConfig: SchedulerConfig = { slots: ["09:00"], timeZone: "America/Toronto" };
  const deps: RuntimeDeps = {
    store,
    contentGenerator,
    codeVerifier,
    voice,
    mascot,
    video,
    publisher,
    gateway,
    scheduler: new DefaultScheduler(),
    schedulerConfig,
    outputDir: "/tmp",
    mascotSheetPath: "sheet.png",
    publishTargets: ["instagram", "facebook"],
    brandHandle: "@CodeWithQuirk",
    now: () => new Date("2026-06-09T12:00:00Z"),
  };
  return { runtime: new Runtime(deps), store, gateway, publisher };
}

describe("Runtime", () => {
  it("drives a question through to review and sends a draft for approval", async () => {
    const { runtime, store, gateway } = makeRuntime();
    const id = await runtime.submitQuestion("how do loops work?");
    expect(store.get(id)?.state).toBe("review");
    expect(gateway.drafts).toEqual([id]);
    // it generated + verified + rendered (script + media attached)
    expect(store.get(id)?.scriptPackage).toBeDefined();
    expect(store.get(id)?.mediaPath).toBe("/tmp/none.mp4");
  });

  it("postNow publishes to all targets and reaches 'posted'", async () => {
    const { runtime, store, publisher } = makeRuntime();
    const id = await runtime.submitQuestion("q");
    await runtime.handleAction("postNow", id);
    expect(store.get(id)?.state).toBe("posted");
    expect(publisher.calls).toHaveLength(1);
    expect(publisher.calls[0]?.targets).toEqual(["instagram", "facebook"]);
  });

  it("routes failed code verification to review (no media) with a revise/reject prompt", async () => {
    const verifier: CodeVerifier = {
      verify: async (s) =>
        s.map((_, i) => ({ snippetIndex: i, ok: false, stdout: "", stderr: "boom" })),
    };
    const { runtime, store, gateway } = makeRuntime({ verifier });
    const id = await runtime.submitQuestion("q");
    expect(store.get(id)?.state).toBe("review");
    expect(store.get(id)?.mediaPath).toBeUndefined();
    // the warning arrives WITH buttons — a plain text reply would start a new job
    const prompt = gateway.prompts.find((p) => p.jobId === id);
    expect(prompt?.message).toContain("didn't run cleanly");
    expect(prompt?.actions).toEqual(["revise", "reject"]);
    expect(gateway.drafts).toHaveLength(0);
  });

  it("reject moves the job to 'rejected'", async () => {
    const { runtime, store } = makeRuntime();
    const id = await runtime.submitQuestion("q");
    await runtime.handleAction("reject", id);
    expect(store.get(id)?.state).toBe("rejected");
  });

  it("ignores a duplicate/stale action without throwing", async () => {
    const { runtime, store } = makeRuntime();
    const id = await runtime.submitQuestion("q");
    await runtime.handleAction("approve", id); // review -> approved
    // duplicate approve / stale revise on an already-approved job must be a no-op,
    // not an IllegalTransition
    await expect(runtime.handleAction("approve", id)).resolves.toBeUndefined();
    await expect(runtime.handleAction("revise", id, "tweak")).resolves.toBeUndefined();
    expect(store.get(id)?.state).toBe("approved");
  });

  it("reject from approved gives up on the job", async () => {
    const { runtime, store } = makeRuntime();
    const id = await runtime.submitQuestion("q");
    await runtime.handleAction("approve", id);
    await runtime.handleAction("reject", id);
    expect(store.get(id)?.state).toBe("rejected");
  });

  it("tick publishes due approved jobs", async () => {
    const { runtime, store, publisher } = makeRuntime();
    const id = await runtime.submitQuestion("q");
    await runtime.handleAction("approve", id); // schedules into a future slot
    // force it due
    const job = store.get(id);
    if (job) store.save({ ...job, scheduledFor: "2026-06-09T00:00:00Z" });
    await runtime.tick();
    expect(store.get(id)?.state).toBe("posted");
    expect(publisher.calls).toHaveLength(1);
  });
});

/** Fails the given platforms on the FIRST publish call, succeeds afterwards. */
class FlakyPublisher implements Publisher {
  calls: Array<{ targets: PublishTarget[]; captions: PostCaptions }> = [];
  constructor(private readonly failFirst: PublishTarget[]) {}
  async publish(_v: string, captions: PostCaptions, targets: PublishTarget[]) {
    this.calls.push({ targets, captions });
    const failing = new Set(this.calls.length === 1 ? this.failFirst : []);
    return targets.map((platform) =>
      failing.has(platform)
        ? { platform, ok: false as const, error: "rate limited" }
        : { platform, ok: true as const },
    );
  }
}

describe("Runtime — publish failure handling", () => {
  it("a failed publish stops auto-retrying; a manual retry skips already-posted platforms", async () => {
    const publisher = new FlakyPublisher(["facebook"]);
    const { runtime, store, gateway } = makeRuntime({ publisher });
    const id = await runtime.submitQuestion("q");
    await runtime.handleAction("postNow", id);

    // partial failure → back to approved, schedule cleared so the tick won't loop
    expect(store.get(id)?.state).toBe("approved");
    expect(store.get(id)?.scheduledFor).toBeUndefined();
    const prompt = gateway.prompts.find(
      (p) => p.jobId === id && p.message.includes("Publish failed"),
    );
    expect(prompt?.actions).toEqual(["postNow", "reject"]);

    await runtime.tick();
    expect(publisher.calls).toHaveLength(1); // no auto-retry on tick

    // operator retries: ONLY the failed platform is attempted (no instagram duplicate)
    await runtime.handleAction("postNow", id);
    expect(publisher.calls).toHaveLength(2);
    expect(publisher.calls[1]?.targets).toEqual(["facebook"]);

    const job = store.get(id);
    expect(job?.state).toBe("posted");
    // the merged record covers every platform
    const okPlatforms = job?.publishResults?.filter((r) => r.ok).map((r) => r.platform) ?? [];
    expect(okPlatforms.sort()).toEqual(["facebook", "instagram"]);
  });

  it("a tick during a slow in-flight publish does not double-post", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let publishCalls = 0;
    const publisher: Publisher = {
      publish: async (_v, _c, targets): Promise<PublishResult> => {
        publishCalls++;
        await gate;
        return targets.map((platform) => ({ platform, ok: true }));
      },
    };
    const { runtime, store } = makeRuntime({ publisher });
    const id = await runtime.submitQuestion("q");
    await runtime.handleAction("approve", id);
    const job = store.get(id);
    if (job) store.save({ ...job, scheduledFor: "2026-06-09T00:00:00Z" });

    const inFlight = runtime.handleAction("postNow", id); // blocks inside publish
    expect(store.get(id)?.state).toBe("publishing"); // invisible to the scheduler
    await runtime.tick(); // a tick mid-publish must not pick the job up again
    release();
    await inFlight;

    expect(publishCalls).toBe(1);
    expect(store.get(id)?.state).toBe("posted");
  });

  it("a publisher exception falls back to approved with a retry prompt (no crash)", async () => {
    const publisher: Publisher = {
      publish: async () => {
        throw new Error("ECONNRESET");
      },
    };
    const { runtime, store, gateway } = makeRuntime({ publisher });
    const id = await runtime.submitQuestion("q");
    await expect(runtime.handleAction("postNow", id)).resolves.toBeUndefined();
    expect(store.get(id)?.state).toBe("approved");
    expect(store.get(id)?.scheduledFor).toBeUndefined();
    const prompt = gateway.prompts.find((p) => p.message.includes("Publish failed"));
    expect(prompt?.actions).toEqual(["postNow", "reject"]);
  });
});

describe("Runtime — crash recovery", () => {
  it("recover() fails jobs stuck mid-pipeline and reverts stuck publishes to approved", async () => {
    const { runtime, store, gateway } = makeRuntime();
    const ts = "2026-06-09T11:00:00.000Z";
    store.save({
      id: "stuck-render",
      question: "q",
      state: "rendering",
      createdAt: ts,
      updatedAt: ts,
    });
    store.save({
      id: "stuck-publish",
      question: "q",
      state: "publishing",
      scheduledFor: ts,
      createdAt: ts,
      updatedAt: ts,
    });

    await runtime.recover();

    expect(store.get("stuck-render")?.state).toBe("failed");
    expect(store.get("stuck-publish")?.state).toBe("approved");
    expect(store.get("stuck-publish")?.scheduledFor).toBeUndefined();
    // the operator hears about both, with a retry prompt for the publish
    expect(gateway.notifications.some((n) => n.includes("Something went wrong"))).toBe(true);
    expect(
      gateway.prompts.some((p) => p.jobId === "stuck-publish" && p.actions.includes("postNow")),
    ).toBe(true);
  });
});
