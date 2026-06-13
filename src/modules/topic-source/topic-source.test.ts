import { afterEach, describe, expect, it, vi } from "vitest";
import { StackOverflowTopicSource, decodeEntities } from "./topic-source.js";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(items: unknown[], ok = true) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => ({ items }),
      text: async () => "err",
    } as Response;
  });
  return calls;
}

describe("decodeEntities", () => {
  it("decodes named and numeric HTML entities", () => {
    expect(decodeEntities("let &amp; var &lt;T&gt; &quot;x&quot; it&#39;s")).toBe(
      'let & var <T> "x" it\'s',
    );
  });
});

describe("StackOverflowTopicSource", () => {
  it("picks the top answered, positively-scored question and decodes its title", async () => {
    const calls = stubFetch([
      { question_id: 1, title: "Unanswered?", score: 50, is_answered: false },
      { question_id: 2, title: "What is a &quot;closure&quot;?", score: 99, is_answered: true },
    ]);
    const src = new StackOverflowTopicSource();
    const topic = await src.nextTopic("javascript", []);
    expect(topic).toEqual({ id: "2", question: 'What is a "closure"?' });
    expect(calls[0]).toContain("tagged=javascript");
    expect(calls[0]).toContain("sort=votes");
  });

  it("skips excluded ids so the same topic is never returned twice", async () => {
    stubFetch([
      { question_id: 2, title: "First pick?", score: 99, is_answered: true },
      { question_id: 3, title: "Second pick?", score: 80, is_answered: true },
    ]);
    const src = new StackOverflowTopicSource();
    const topic = await src.nextTopic("python", ["2"]);
    expect(topic?.id).toBe("3");
  });

  it("skips non-question titles", async () => {
    stubFetch([
      { question_id: 4, title: "Bug in my code please help", score: 10, is_answered: true },
      { question_id: 5, title: "How do generators work?", score: 9, is_answered: true },
    ]);
    const src = new StackOverflowTopicSource();
    const topic = await src.nextTopic("python", []);
    expect(topic?.id).toBe("5");
  });

  it("returns null when nothing qualifies", async () => {
    stubFetch([{ question_id: 6, title: "No?", score: 0, is_answered: false }]);
    const src = new StackOverflowTopicSource();
    expect(await src.nextTopic("rust", [])).toBeNull();
  });

  it("throws on a non-ok response", async () => {
    stubFetch([], false);
    const src = new StackOverflowTopicSource();
    await expect(src.nextTopic("go", [])).rejects.toThrow("Stack Overflow 500");
  });

  it("includes the api key in the request when configured", async () => {
    const calls = stubFetch([
      { question_id: 7, title: "What is hoisting?", score: 5, is_answered: true },
    ]);
    const src = new StackOverflowTopicSource({ apiKey: "secret-key" });
    await src.nextTopic("javascript", []);
    expect(calls[0]).toContain("key=secret-key");
  });
});
