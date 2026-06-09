import { describe, expect, it } from "vitest";
import { MockPublisher, allPublished } from "./publisher.js";

describe("MockPublisher — all success", () => {
  it("returns one ok:true item per target in input order", async () => {
    const mock = new MockPublisher();

    const result = await mock.publish("/tmp/v.mp4", "cap", ["instagram", "facebook"]);

    expect(result).toHaveLength(2);
    expect(result[0]?.platform).toBe("instagram");
    expect(result[0]?.ok).toBe(true);
    expect(result[1]?.platform).toBe("facebook");
    expect(result[1]?.ok).toBe(true);
  });
});

describe("MockPublisher — partial failure", () => {
  it("returns ok:true for instagram and ok:false with error for configured facebook failure", async () => {
    const mock = new MockPublisher({ facebook: { ok: false, error: "rate limited" } });

    const result = await mock.publish("/tmp/v.mp4", "cap", ["instagram", "facebook"]);

    expect(result).toHaveLength(2);
    expect(result[0]?.platform).toBe("instagram");
    expect(result[0]?.ok).toBe(true);
    expect(result[0]?.error).toBeUndefined();
    expect(result[1]?.platform).toBe("facebook");
    expect(result[1]?.ok).toBe(false);
    expect(result[1]?.error).toBe("rate limited");
  });
});

describe("MockPublisher — single target", () => {
  it("returns exactly one result item when only one target is given", async () => {
    const mock = new MockPublisher();

    const result = await mock.publish("/tmp/v.mp4", "cap", ["instagram"]);

    expect(result).toHaveLength(1);
    expect(result[0]?.platform).toBe("instagram");
    expect(result[0]?.ok).toBe(true);
  });
});

describe("MockPublisher — call recording", () => {
  it("records the videoPath, caption, and targets of each publish call", async () => {
    const mock = new MockPublisher();

    await mock.publish("/tmp/v.mp4", "my caption", ["instagram", "facebook"]);

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.videoPath).toBe("/tmp/v.mp4");
    expect(mock.calls[0]?.caption).toBe("my caption");
    expect(mock.calls[0]?.targets).toEqual(["instagram", "facebook"]);
  });
});

describe("allPublished", () => {
  it("returns true when every item is ok", () => {
    const result = [
      { platform: "instagram" as const, ok: true },
      { platform: "facebook" as const, ok: true },
    ];
    expect(allPublished(result)).toBe(true);
  });

  it("returns false when any item failed", () => {
    const result = [
      { platform: "instagram" as const, ok: true },
      { platform: "facebook" as const, ok: false, error: "rate limited" },
    ];
    expect(allPublished(result)).toBe(false);
  });

  it("returns true for an empty array (vacuous)", () => {
    expect(allPublished([])).toBe(true);
  });
});

describe("MockPublisher — order preserved", () => {
  it("returns results in the same order as targets input when reversed", async () => {
    const mock = new MockPublisher();

    const result = await mock.publish("/tmp/v.mp4", "cap", ["facebook", "instagram"]);

    expect(result).toHaveLength(2);
    expect(result[0]?.platform).toBe("facebook");
    expect(result[1]?.platform).toBe("instagram");
  });
});
