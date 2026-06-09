import { afterEach, describe, expect, it, vi } from "vitest";
import { BlotatoPublisher } from "./blotato-publisher.js";
import { composeCaption } from "./publisher.js";

describe("composeCaption", () => {
  it("appends a CTA + hashtags and always includes the branded tag (deduped)", () => {
    const out = composeCaption("Great tip!", ["javascript", "CodeWithQuirk", "#webdev"]);
    expect(out).toContain("Great tip!");
    expect(out).toContain("💻 Follow @CodeWithQuirk for daily dev tips!");
    expect(out).toContain("#javascript");
    expect(out).toContain("#webdev"); // leading # normalized, not doubled
    expect(out).not.toContain("##");
    // branded tag present exactly once
    expect(out.match(/#CodeWithQuirk\b/gi)?.length).toBe(1);
  });

  it("adds #CodeWithQuirk when the model omitted it", () => {
    expect(composeCaption("x", ["coding"])).toContain("#CodeWithQuirk");
  });
});

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
    const res = await pub.publish(
      "/data/media/job.mp4",
      { instagram: "ig", facebook: "fb", tiktok: "tt" },
      ["instagram", "facebook", "tiktok"],
    );
    expect(res.every((r) => r.ok)).toBe(true);
    const bodies = calls.map((c) => JSON.parse(c.init.body as string).post);
    // instagram: bare targetType + correct accountId + media url
    expect(bodies[0].target).toEqual({ targetType: "instagram" });
    expect(bodies[0].accountId).toBe("ig-1");
    expect(bodies[0].content.mediaUrls).toEqual(["https://cdn.example.com/media/job.mp4"]);
    // each platform gets its OWN caption text from the map
    expect(bodies[0].content.text).toBe("ig");
    expect(bodies[1].content.text).toBe("fb");
    expect(bodies[2].content.text).toBe("tt");
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
    const res = await new BlotatoPublisher(fullCfg).publish(
      "/x.mp4",
      { instagram: "c", facebook: "c" },
      ["instagram", "facebook"],
    );
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
    const res = await pub.publish("/x.mp4", { facebook: "c" }, ["facebook"]);
    expect(res[0]?.ok).toBe(false);
    expect(res[0]?.error).toContain("facebookPageId");
  });

  it("fails a platform with no configured accountId", async () => {
    stubFetch(() => ({ ok: true, json: {} }));
    const pub = new BlotatoPublisher({ apiKey: "k", publicBaseUrl: "https://cdn.example.com" });
    const res = await pub.publish("/x.mp4", { instagram: "c" }, ["instagram"]);
    expect(res[0]?.ok).toBe(false);
    expect(res[0]?.error).toContain("no Blotato accountId");
  });
});
