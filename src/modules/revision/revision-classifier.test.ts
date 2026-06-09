import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { ModelClient, ModelRole } from "../content-generator/content-generator.js";
import type { RevisionClassification } from "./revision-classifier.js";
import { DefaultRevisionClassifier } from "./revision-classifier.js";

// ─── MockModelClient ────────────────────────────────────────────────────────

interface CallRecord {
  role: ModelRole;
  prompt: string;
}

class MockModelClient implements ModelClient {
  readonly calls: CallRecord[] = [];

  constructor(private readonly response: RevisionClassification) {}

  async generateObject<T>(role: ModelRole, prompt: string, _schema: z.ZodType<T>): Promise<T> {
    this.calls.push({ role, prompt });
    return this.response as T;
  }

  lastCall(): CallRecord {
    const last = this.calls[this.calls.length - 1];
    if (last === undefined) throw new Error("No calls recorded");
    return last;
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("DefaultRevisionClassifier", () => {
  it("classifies code instruction → stages include 'code'", async () => {
    const mock = new MockModelClient({ stages: ["code"] });
    const classifier = new DefaultRevisionClassifier(mock);
    const result = await classifier.classify("the loop example is wrong, use for...of");
    expect(result.stages).toContain("code");
    expect(mock.lastCall().role).toBe("glue");
  });

  it("classifies copy instruction → stages include 'script'", async () => {
    const mock = new MockModelClient({ stages: ["script"] });
    const classifier = new DefaultRevisionClassifier(mock);
    const result = await classifier.classify("make the hook punchier");
    expect(result.stages).toContain("script");
    expect(mock.lastCall().role).toBe("glue");
  });

  it("classifies voice instruction → stages include 'voice'", async () => {
    const mock = new MockModelClient({ stages: ["voice"] });
    const classifier = new DefaultRevisionClassifier(mock);
    const result = await classifier.classify("read it slower");
    expect(result.stages).toContain("voice");
  });

  it("classifies render instruction → stages include 'render'", async () => {
    const mock = new MockModelClient({ stages: ["render"] });
    const classifier = new DefaultRevisionClassifier(mock);
    const result = await classifier.classify("change the music");
    expect(result.stages).toContain("render");
  });

  it("empty-guard: model returns empty stages → classifier returns ['script']", async () => {
    const mock = new MockModelClient({ stages: [] });
    const classifier = new DefaultRevisionClassifier(mock);
    const result = await classifier.classify("something");
    expect(result.stages).toEqual(["script"]);
    expect(result.stages.length).toBeGreaterThan(0);
  });

  it("instruction text is included in the prompt passed to the model", async () => {
    const instruction = "make the hook punchier and change the background color";
    const mock = new MockModelClient({ stages: ["script", "render"] });
    const classifier = new DefaultRevisionClassifier(mock);
    await classifier.classify(instruction);
    expect(mock.lastCall().prompt).toContain(instruction);
  });
});
