import { describe, expect, it } from "vitest";
import type { Job } from "../domain/job.js";
import type { ScriptPackage } from "../domain/script-package.js";
import type { CodeVerifier } from "../modules/code-verifier/index.js";
import type { ContentGenerator } from "../modules/content-generator/index.js";
import type {
  ActionHandler,
  ConversationGateway,
  QuestionHandler,
} from "../modules/conversation-gateway/index.js";
import { SqliteJobStore } from "../modules/job-store/job-store.js";
import type { MascotSequencer } from "../modules/mascot-sequencer/index.js";
import { MockPublisher } from "../modules/publisher/index.js";
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
}

function makeRuntime(overrides?: {
  verifier?: CodeVerifier;
  publisher?: MockPublisher;
}) {
  const store = new SqliteJobStore(":memory:");
  const gateway = new RecordingGateway();
  const publisher = overrides?.publisher ?? new MockPublisher();
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

  it("routes failed code verification to review (no media) with a warning", async () => {
    const verifier: CodeVerifier = {
      verify: async (s) =>
        s.map((_, i) => ({ snippetIndex: i, ok: false, stdout: "", stderr: "boom" })),
    };
    const { runtime, store, gateway } = makeRuntime({ verifier });
    const id = await runtime.submitQuestion("q");
    expect(store.get(id)?.state).toBe("review");
    expect(store.get(id)?.mediaPath).toBeUndefined();
    expect(gateway.notifications.some((n) => n.includes("didn't run cleanly"))).toBe(true);
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
    // second approve on an already-approved job must be a no-op, not an IllegalTransition
    await expect(runtime.handleAction("approve", id)).resolves.toBeUndefined();
    await expect(runtime.handleAction("reject", id)).resolves.toBeUndefined();
    expect(store.get(id)?.state).toBe("approved");
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
