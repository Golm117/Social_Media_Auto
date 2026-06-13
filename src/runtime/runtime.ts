import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Job, JobId, JobState } from "../domain/job.js";
import { type CodeVerifier, allPassed, failureSummaries } from "../modules/code-verifier/index.js";
import type { ContentGenerator } from "../modules/content-generator/index.js";
import type { ConversationGateway, OperatorAction } from "../modules/conversation-gateway/index.js";
import { type Intent, type JobEvent, advance } from "../modules/job-orchestrator/index.js";
import type { JobStore } from "../modules/job-store/job-store.js";
import type { MascotSequencer } from "../modules/mascot-sequencer/index.js";
import {
  type PostCaptions,
  type PublishTarget,
  type Publisher,
  allPublished,
  composeCaption,
} from "../modules/publisher/index.js";
import type { Scheduler, SchedulerConfig } from "../modules/scheduler/index.js";
import type { TopicSource } from "../modules/topic-source/index.js";
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
  /** Optional auto-topic source for the daily auto-draft (e.g. Stack Overflow). */
  topicSource?: TopicSource;
  /** Languages the auto-topic rotates through, one per day. */
  autoTopicLanguages?: string[];
  outputDir: string;
  mascotSheetPath: string;
  /** Optional background-music file, mixed quietly under the voiceover. */
  musicPath?: string;
  publishTargets: PublishTarget[];
  brandHandle: string;
  now: () => Date;
}

function formatSlot(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
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
      return `⚠️ The code didn't run cleanly:\n${intent.detail ?? ""}\n\nTap ✏️ Revise to send a fix, or ❌ Reject.`;
    case "posted":
      return `📲 Posted to ${intent.detail || "your platforms"}! ✓`;
    case "publish_failed":
      return `❌ Publish failed: ${intent.detail ?? ""}\nTap ⚡ Post now to retry (already-posted platforms are skipped), or ❌ Reject.`;
    default:
      return `💥 Something went wrong: ${intent.detail ?? "unknown error"}`;
  }
}

export class Runtime {
  private ticking = false;

  constructor(private readonly deps: RuntimeDeps) {}

  /** Wire gateway handlers + the scheduler tick. */
  start(): void {
    this.deps.gateway.onQuestion(async (question) => {
      await this.submitQuestion(question);
    });
    this.deps.gateway.onAction((action, jobId, payload) =>
      this.handleAction(action, jobId, payload),
    );
    this.deps.gateway.onQueueRequest(() => this.queueSummary());
  }

  /** Human-readable summary of upcoming scheduled posts (for the /queue command). */
  queueSummary(): string {
    const tz = this.deps.schedulerConfig.timeZone;
    const approved = this.deps.store.listByState("approved");
    const scheduled = approved
      .filter((j): j is Job & { scheduledFor: string } => j.scheduledFor !== undefined)
      .sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1));
    const needsRetry = approved.filter((j) => j.scheduledFor === undefined);

    const lines: string[] = [];
    if (scheduled.length > 0) {
      lines.push("🗓 Upcoming posts:");
      lines.push(
        ...scheduled.map(
          (j, i) => `${i + 1}. ${formatSlot(j.scheduledFor, tz)} — ${j.question.slice(0, 60)}`,
        ),
      );
    }
    if (needsRetry.length > 0) {
      lines.push("⚠️ Awaiting manual retry (publish failed):");
      lines.push(...needsRetry.map((j) => `• ${j.question.slice(0, 60)}`));
    }
    return lines.length > 0 ? lines.join("\n") : "🗓 Queue is empty — nothing scheduled.";
  }

  async submitQuestion(question: string, opts?: { topicId?: string }): Promise<JobId> {
    const ts = this.deps.now().toISOString();
    const job: Job = {
      id: randomUUID(),
      question,
      state: "draft",
      createdAt: ts,
      updatedAt: ts,
      ...(opts?.topicId ? { topicId: opts.topicId } : {}),
    };
    this.deps.store.save(job);
    await this.dispatch(job.id, { type: "QuestionSubmitted" });
    return job.id;
  }

  /**
   * Daily auto-draft: pick a fresh top topic for the day's rotating language and run it
   * through the full pipeline. The finished video lands in Telegram with the usual
   * Approve buttons — the operator still approves every post (one tap).
   */
  async autoTopic(): Promise<void> {
    const source = this.deps.topicSource;
    const languages = this.deps.autoTopicLanguages ?? [];
    if (!source || languages.length === 0) return;

    const dayIndex = Math.floor(this.deps.now().getTime() / 86_400_000);
    const language = languages[dayIndex % languages.length] as string;
    const usedTopicIds = this.deps.store
      .listAll()
      .map((j) => j.topicId)
      .filter((id): id is string => id !== undefined);

    let topic: Awaited<ReturnType<TopicSource["nextTopic"]>>;
    try {
      topic = await source.nextTopic(language, usedTopicIds);
    } catch (e) {
      await this.deps.gateway.announce(`⚠️ Auto-topic (${language}) lookup failed: ${String(e)}`);
      return;
    }
    if (!topic) {
      await this.deps.gateway.announce(
        `ℹ️ No fresh ${language} topic today — skipping the auto draft.`,
      );
      return;
    }
    await this.deps.gateway.announce(
      `🤖 Auto-topic (${language}): "${topic.question}" — drafting…`,
    );
    await this.submitQuestion(topic.question, { topicId: topic.id });
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
        await this.deps.gateway.notify(
          job,
          `🗓 Scheduled — will post ${formatSlot(slot.toISOString(), this.deps.schedulerConfig.timeZone)}. Send /queue to see what's lined up.`,
        );
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
        // also legal from "approved", to give up on a job that keeps failing to publish
        if (job.state !== "review" && job.state !== "approved") return;
        await this.dispatch(jobId, { type: "Rejected" });
        return;
      }
    }
  }

  /** Scheduler tick: publish any approved jobs that are due. */
  async tick(): Promise<void> {
    if (this.ticking) return; // a slow publish must not overlap the next tick
    this.ticking = true;
    try {
      const due = this.deps.scheduler.dueJobs(
        this.deps.store.listByState("approved"),
        this.deps.now(),
      );
      for (const job of due) {
        await this.dispatch(job.id, { type: "PublishRequested" });
      }
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Re-route jobs a previous process left in-flight (crash/restart mid-pipeline).
   * Publishing jobs fall back to "approved" with a retry prompt; earlier stages fail
   * with a notify so the operator knows to re-ask.
   */
  async recover(): Promise<void> {
    const inFlight: JobState[] = ["generating", "verifying", "rendering", "revising", "publishing"];
    for (const state of inFlight) {
      for (const job of this.deps.store.listByState(state)) {
        await this.dispatch(job.id, {
          type: "StageFailed",
          stage: state,
          error: "interrupted by a restart",
        });
      }
    }
  }

  // Drop scheduledFor so the tick does NOT auto-retry a failed publish every minute —
  // retrying is the operator's call (⚡ Post now on the failure prompt).
  private static clearSchedule(job: Job): Job {
    const { scheduledFor: _, ...rest } = job;
    return rest;
  }

  private applyEventData(job: Job, event: JobEvent): Job {
    switch (event.type) {
      case "ContentGenerated":
        return { ...job, scriptPackage: event.scriptPackage };
      case "RenderCompleted":
        return { ...job, mediaPath: event.mediaPath };
      case "Published":
        return { ...job, publishResults: event.results };
      case "PublishFailed":
        return Runtime.clearSchedule({ ...job, publishResults: event.results });
      case "StageFailed":
        return event.stage === "publishing" ? Runtime.clearSchedule(job) : job;
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
      case "NotifyOperator": {
        // failure notices carry the buttons the operator needs to act on them
        const text = notifyText(intent);
        if (intent.kind === "verification_failed") {
          await this.deps.gateway.sendActionPrompt(job, text, ["revise", "reject"]);
        } else if (intent.kind === "publish_failed") {
          await this.deps.gateway.sendActionPrompt(job, text, ["postNow", "reject"]);
        } else {
          await this.deps.gateway.notify(job, text);
        }
        return;
      }
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
            ...(this.deps.musicPath ? { musicPath: this.deps.musicPath } : {}),
            mascotTrackPath: trackPath,
            timings,
            mascotSheetPath: this.deps.mascotSheetPath,
            outputPath: join(this.deps.outputDir, `${job.id}.mp4`),
          });
          // the voiceover + track are baked into the mp4 — don't let temp files pile up
          await rm(audioPath, { force: true }).catch(() => {});
          await rm(trackPath, { force: true }).catch(() => {});
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
        // on retry, skip platforms that already succeeded — no duplicate posts
        const prior = job.publishResults ?? [];
        const done = new Set(prior.filter((r) => r.ok).map((r) => r.platform));
        const targets = this.deps.publishTargets.filter((t) => !done.has(t));
        if (targets.length === 0) {
          await this.dispatch(job.id, { type: "Published", results: prior });
          return;
        }
        try {
          await this.deps.gateway.notify(job, `📤 Uploading & posting to ${targets.join(", ")}…`);
          // tailor a caption per platform (IG fuller, FB lighter, TikTok punchy)
          const captions: PostCaptions = {};
          for (const p of targets) {
            captions[p] = composeCaption(sp.socialCaption, sp.hashtags, {
              brandHandle: this.deps.brandHandle,
              platform: p,
            });
          }
          const fresh = await this.deps.publisher.publish(job.mediaPath, captions, targets);
          // merge earlier successes back in so the final record covers every platform
          const results = [
            ...prior.filter((r) => r.ok && !fresh.some((f) => f.platform === r.platform)),
            ...fresh,
          ];
          if (allPublished(results)) await this.dispatch(job.id, { type: "Published", results });
          else await this.dispatch(job.id, { type: "PublishFailed", results });
        } catch (e) {
          await fail("publishing", e);
        }
        return;
      }
      case "Cleanup":
        if (job.mediaPath) await rm(job.mediaPath, { force: true }).catch(() => {});
        return;
    }
  }
}
