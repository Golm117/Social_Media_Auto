import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Job, JobId } from "../domain/job.js";
import { type CodeVerifier, allPassed, failureSummaries } from "../modules/code-verifier/index.js";
import type { ContentGenerator } from "../modules/content-generator/index.js";
import type { ConversationGateway, OperatorAction } from "../modules/conversation-gateway/index.js";
import { type Intent, type JobEvent, advance } from "../modules/job-orchestrator/index.js";
import type { JobStore } from "../modules/job-store/job-store.js";
import type { MascotSequencer } from "../modules/mascot-sequencer/index.js";
import { type PublishTarget, type Publisher, allPublished } from "../modules/publisher/index.js";
import type { Scheduler, SchedulerConfig } from "../modules/scheduler/index.js";
import type { VideoComposer } from "../modules/video-composer/index.js";
import type { VoiceSynthesizer } from "../modules/voice-synthesizer/index.js";

export interface RuntimeDeps {
  store: JobStore;
  contentGenerator: ContentGenerator;
  codeVerifier: CodeVerifier;
  voice: VoiceSynthesizer;
  mascot: MascotSequencer;
  video: VideoComposer;
  publisher: Publisher;
  gateway: ConversationGateway;
  scheduler: Scheduler;
  schedulerConfig: SchedulerConfig;
  outputDir: string;
  mascotSheetPath: string;
  publishTargets: PublishTarget[];
  now: () => Date;
}

function notifyText(intent: Extract<Intent, { type: "NotifyOperator" }>): string {
  switch (intent.kind) {
    case "generating":
      return "📝 Drafting your answer…";
    case "verifying":
      return "✅ Verifying the code in a sandbox…";
    case "rendering":
      return "🎬 Rendering Coddy's video…";
    case "verification_failed":
      return `⚠️ The code didn't run cleanly:\n${intent.detail ?? ""}\n\nReply with a fix, or tap ❌ Reject.`;
    case "posted":
      return "📲 Posted to Instagram + Facebook! ✓";
    case "publish_failed":
      return `❌ Publish failed: ${intent.detail ?? ""}\nTap ✅ again to retry.`;
    default:
      return `💥 Something went wrong: ${intent.detail ?? "unknown error"}`;
  }
}

export class Runtime {
  constructor(private readonly deps: RuntimeDeps) {}

  /** Wire gateway handlers + the scheduler tick. */
  start(): void {
    this.deps.gateway.onQuestion(async (question) => {
      await this.submitQuestion(question);
    });
    this.deps.gateway.onAction((action, jobId, payload) =>
      this.handleAction(action, jobId, payload),
    );
  }

  async submitQuestion(question: string): Promise<JobId> {
    const ts = this.deps.now().toISOString();
    const job: Job = {
      id: randomUUID(),
      question,
      state: "draft",
      createdAt: ts,
      updatedAt: ts,
    };
    this.deps.store.save(job);
    await this.dispatch(job.id, { type: "QuestionSubmitted" });
    return job.id;
  }

  // State-aware + idempotent: a stale/duplicate button tap is ignored rather than
  // dispatching an illegal event (which would otherwise throw).
  async handleAction(action: OperatorAction, jobId: JobId, payload?: string): Promise<void> {
    const job = this.deps.store.get(jobId);
    if (!job) return;
    switch (action) {
      case "approve": {
        if (job.state !== "review") return;
        const pending = this.deps.store
          .listByState("approved")
          .filter((j) => j.scheduledFor)
          .map((j) => new Date(j.scheduledFor as string));
        const slot = this.deps.scheduler.assignSlot(
          pending,
          this.deps.now(),
          this.deps.schedulerConfig,
        );
        this.deps.store.save({ ...job, scheduledFor: slot.toISOString() });
        await this.dispatch(jobId, { type: "Approved" });
        return;
      }
      case "postNow": {
        if (job.state === "review") {
          this.deps.store.save({ ...job, scheduledFor: this.deps.now().toISOString() });
          await this.dispatch(jobId, { type: "Approved" });
          await this.dispatch(jobId, { type: "PublishRequested" });
        } else if (job.state === "approved") {
          // already approved (e.g. scheduled) — just publish now
          await this.dispatch(jobId, { type: "PublishRequested" });
        }
        return;
      }
      case "revise": {
        if (job.state !== "review") return;
        this.deps.store.save({ ...job, lastRevision: payload ?? "" });
        await this.dispatch(jobId, { type: "ReviseRequested", instructions: payload ?? "" });
        return;
      }
      case "reject": {
        if (job.state !== "review") return;
        await this.dispatch(jobId, { type: "Rejected" });
        return;
      }
    }
  }

  /** Scheduler tick: publish any approved jobs that are due. */
  async tick(): Promise<void> {
    const due = this.deps.scheduler.dueJobs(
      this.deps.store.listByState("approved"),
      this.deps.now(),
    );
    for (const job of due) {
      await this.dispatch(job.id, { type: "PublishRequested" });
    }
  }

  private applyEventData(job: Job, event: JobEvent): Job {
    switch (event.type) {
      case "ContentGenerated":
        return { ...job, scriptPackage: event.scriptPackage };
      case "RenderCompleted":
        return { ...job, mediaPath: event.mediaPath };
      case "Published":
      case "PublishFailed":
        return { ...job, publishResults: event.results };
      default:
        return job;
    }
  }

  /** Advance the state machine, persist, and execute the resulting intents. */
  async dispatch(jobId: JobId, event: JobEvent): Promise<void> {
    const existing = this.deps.store.get(jobId);
    if (!existing) return;
    const withData = this.applyEventData(existing, event);
    const { state, intents } = advance(withData, event);
    const updated: Job = { ...withData, state, updatedAt: this.deps.now().toISOString() };
    this.deps.store.save(updated);
    for (const intent of intents) {
      await this.executeIntent(updated, intent);
    }
  }

  private async executeIntent(job: Job, intent: Intent): Promise<void> {
    const fail = (stage: Job["state"], err: unknown) =>
      this.dispatch(job.id, { type: "StageFailed", stage, error: String(err) });

    switch (intent.type) {
      case "NotifyOperator":
        await this.deps.gateway.notify(job, notifyText(intent));
        return;
      case "GenerateContent":
        try {
          const scriptPackage = await this.deps.contentGenerator.generate(
            job.question,
            job.lastRevision,
          );
          await this.dispatch(job.id, { type: "ContentGenerated", scriptPackage });
        } catch (e) {
          await fail("generating", e);
        }
        return;
      case "VerifyCode": {
        const sp = job.scriptPackage;
        if (!sp) return;
        const snippets = sp.bodySteps
          .filter((s) => s.code && s.language)
          .map((s) => ({ code: s.code as string, language: s.language as "javascript" }));
        try {
          const res = await this.deps.codeVerifier.verify(snippets);
          if (allPassed(res)) await this.dispatch(job.id, { type: "CodeVerified" });
          else
            await this.dispatch(job.id, {
              type: "CodeVerificationFailed",
              failures: failureSummaries(res),
            });
        } catch (e) {
          await fail("verifying", e);
        }
        return;
      }
      case "RenderVideo": {
        const sp = job.scriptPackage;
        if (!sp) return;
        try {
          const { audioPath, timings } = await this.deps.voice.synthesize(sp.voiceoverText);
          const { trackPath } = await this.deps.mascot.sequence(sp.mascotCues, timings);
          const { videoPath } = await this.deps.video.compose({
            scriptPackage: sp,
            audioPath,
            mascotTrackPath: trackPath,
            timings,
            mascotSheetPath: this.deps.mascotSheetPath,
            outputPath: join(this.deps.outputDir, `${job.id}.mp4`),
          });
          await this.dispatch(job.id, { type: "RenderCompleted", mediaPath: videoPath });
        } catch (e) {
          await fail("rendering", e);
        }
        return;
      }
      case "SendForApproval":
        await this.deps.gateway.sendDraftForApproval(job);
        return;
      case "PublishPost": {
        const sp = job.scriptPackage;
        if (!sp || !job.mediaPath) return;
        await this.deps.gateway.notify(
          job,
          `📤 Uploading & posting to ${this.deps.publishTargets.join(", ")}…`,
        );
        try {
          const results = await this.deps.publisher.publish(
            job.mediaPath,
            sp.socialCaption,
            this.deps.publishTargets,
          );
          if (allPublished(results)) await this.dispatch(job.id, { type: "Published", results });
          else await this.dispatch(job.id, { type: "PublishFailed", results });
        } catch (e) {
          await fail("approved", e);
        }
        return;
      }
      case "Cleanup":
        if (job.mediaPath) await rm(job.mediaPath, { force: true }).catch(() => {});
        return;
    }
  }
}
