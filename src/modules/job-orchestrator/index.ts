import type { Job, JobState } from "../../domain/job.js";

// TODO: slice 2 — event/intent types defined there
export interface JobOrchestrator {
  advance(job: Job, event: unknown): { state: JobState; intents: unknown[] };
}
