import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../../domain/job.js";
import type { ScriptPackage } from "../../domain/script-package.js";
import { SqliteJobStore } from "./job-store.js";

const FULL_SCRIPT_PACKAGE: ScriptPackage = {
  templateId: "60-second-concept",
  hook: "Did you know async/await hides a secret?",
  bodySteps: [
    {
      text: "It compiles to a state machine",
      code: "async function foo() {}",
      language: "javascript",
    },
    { text: "Each await is a checkpoint" },
  ],
  voiceoverText: "Let me show you something wild about async/await.",
  captionsText: "async/await secret revealed",
  socialCaption: "async/await is NOT what you think 🤯",
  hashtags: ["javascript", "webdev", "coding"],
  coverSpec: { title: "async/await secret", subtitle: "You need to know this" },
  mascotCues: [
    { state: "intro", atStep: -1 },
    { state: "excited", atStep: 0 },
    { state: "outro", atStep: 2 },
  ],
};

function makeJob(overrides: Partial<Job> = {}): Job {
  const now = new Date().toISOString();
  return {
    id: "job-001",
    question: "How does async/await work?",
    state: "draft",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("SqliteJobStore", () => {
  let store: SqliteJobStore;

  beforeEach(() => {
    store = new SqliteJobStore(":memory:");
  });

  it("round-trips a full Job with scriptPackage losslessly", () => {
    const job = makeJob({ scriptPackage: FULL_SCRIPT_PACKAGE });
    store.save(job);
    const retrieved = store.get(job.id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(job.id);
    expect(retrieved?.question).toBe(job.question);
    expect(retrieved?.state).toBe(job.state);
    expect(retrieved?.scriptPackage).toEqual(FULL_SCRIPT_PACKAGE);
  });

  it("updates an existing job on save and bumps updatedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const original = makeJob({ state: "draft" });
    store.save(original);

    const originalRetrieved = store.get(original.id);
    const originalUpdatedAt = originalRetrieved?.updatedAt ?? "";

    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    const updated: Job = { ...original, state: "generating" };
    store.save(updated);
    vi.useRealTimers();

    const all = store.listByState("generating");
    expect(all).toHaveLength(1);

    const retrieved = store.get(original.id);
    expect(retrieved?.state).toBe("generating");
    expect(retrieved?.updatedAt).not.toBe(originalUpdatedAt);

    // no duplicate — draft list should be empty
    expect(store.listByState("draft")).toHaveLength(0);
  });

  it("listByState returns only jobs in that state", () => {
    store.save(makeJob({ id: "j1", state: "draft" }));
    store.save(makeJob({ id: "j2", state: "draft" }));
    store.save(makeJob({ id: "j3", state: "generating" }));

    const drafts = store.listByState("draft");
    expect(drafts).toHaveLength(2);
    expect(drafts.every((j) => j.state === "draft")).toBe(true);

    const generating = store.listByState("generating");
    expect(generating).toHaveLength(1);
    expect(generating[0]?.id).toBe("j3");

    expect(store.listByState("failed")).toHaveLength(0);
  });

  it("get returns undefined for unknown id", () => {
    expect(store.get("does-not-exist")).toBeUndefined();
  });
});
