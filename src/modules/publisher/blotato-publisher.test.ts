import { afterEach, describe, expect, it, vi } from "vitest";
import { BlotatoPublisher } from "./blotato-publisher.js";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(
  impl: (url: string, init: RequestInit) => { ok: boolean; status?: number; json?: unknown },
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = impl(url, init);
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.json ?? {},
      text: async () => "err",
    } as Response;
  });
  return calls;
}

const fullCfg = {
  apiKey: "k",
  accountIds: { instagram: "ig-1", facebook: "fb-1", tiktok: "tt-1" },
  facebookPageId: "page-9",
  publicBaseUrl: "https://cdn.example.com",
};

describe("BlotatoPublisher", () => {
  it("builds the correct per-platform target for instagram, facebook, tiktok", async () => {
    const calls = stubFetch(() => ({ ok: true, json: { id: "p" } }));
    const pub = new BlotatoPublisher(fullCfg);
    const res = await pub.publish("/data/media/job.mp4", "hi #js", [
      "instagram",
      "facebook",
      "tiktok",
    ]);
    expect(res.every((r) => r.ok)).toBe(true);
    const bodies = calls.map((c) => JSON.parse(c.init.body as string).post);
    // instagram: bare targetType + correct accountId + media url
    expect(bodies[0].target).toEqual({ targetType: "instagram" });
    expect(bodies[0].accountId).toBe("ig-1");
    expect(bodies[0].content.mediaUrls).toEqual(["https://cdn.example.com/media/job.mp4"]);
    // facebook: requires pageId
    expect(bodies[1].target).toEqual({ targetType: "facebook", pageId: "page-9" });
    // tiktok: required flags incl. AI disclosure
    expect(bodies[2].target.targetType).toBe("tiktok");
    expect(bodies[2].target.isAiGenerated).toBe(true);
    expect(bodies[2].target.privacyLevel).toBe("PUBLIC_TO_EVERYONE");
  });

  it("reports per-platform failure (partial)", async () => {
    stubFetch((_url, init) => {
      const body = JSON.parse(init.body as string);
      return body.post.accountId === "fb-1"
        ? { ok: false, status: 429 }
        : { ok: true, json: { id: "p" } };
    });
    const res = await new BlotatoPublisher(fullCfg).publish("/x.mp4", "c", [
      "instagram",
      "facebook",
    ]);
    expect(res[0]).toEqual({ platform: "instagram", ok: true });
    expect(res[1]?.ok).toBe(false);
    expect(res[1]?.error).toContain("429");
  });

  it("fails facebook when no Page id is configured", async () => {
    stubFetch(() => ({ ok: true, json: {} }));
    const pub = new BlotatoPublisher({
      apiKey: "k",
      accountIds: { facebook: "fb-1" },
      publicBaseUrl: "https://cdn.example.com",
    });
    const res = await pub.publish("/x.mp4", "c", ["facebook"]);
    expect(res[0]?.ok).toBe(false);
    expect(res[0]?.error).toContain("facebookPageId");
  });

  it("fails a platform with no configured accountId", async () => {
    stubFetch(() => ({ ok: true, json: {} }));
    const pub = new BlotatoPublisher({ apiKey: "k", publicBaseUrl: "https://cdn.example.com" });
    const res = await pub.publish("/x.mp4", "c", ["instagram"]);
    expect(res[0]?.ok).toBe(false);
    expect(res[0]?.error).toContain("no Blotato accountId");
  });
});
