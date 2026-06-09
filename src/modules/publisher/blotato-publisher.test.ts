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

describe("BlotatoPublisher", () => {
  it("posts to each target with accountId + mediaUrls, using a public URL (no upload)", async () => {
    const calls = stubFetch(() => ({ ok: true, json: { id: "p1" } }));
    const pub = new BlotatoPublisher({
      apiKey: "k",
      accountIds: { instagram: "ig-1", facebook: "fb-1" },
      publicBaseUrl: "https://cdn.example.com",
    });
    const res = await pub.publish("/data/media/job.mp4", "hi #js", ["instagram", "facebook"]);
    expect(res).toEqual([
      { platform: "instagram", ok: true },
      { platform: "facebook", ok: true },
    ]);
    // two /v2/posts calls (no /v2/media upload since publicBaseUrl is set)
    expect(calls.every((c) => c.url.endsWith("/v2/posts"))).toBe(true);
    const body = JSON.parse(calls[0]?.init.body as string);
    expect(body.post.accountId).toBe("ig-1");
    expect(body.post.content.mediaUrls).toEqual(["https://cdn.example.com/media/job.mp4"]);
    expect((calls[0]?.init.headers as Record<string, string>)["blotato-api-key"]).toBe("k");
  });

  it("reports per-platform failure (partial)", async () => {
    stubFetch((_url, init) => {
      const body = JSON.parse(init.body as string);
      return body.post.accountId === "fb-1"
        ? { ok: false, status: 429 }
        : { ok: true, json: { id: "p" } };
    });
    const pub = new BlotatoPublisher({
      apiKey: "k",
      accountIds: { instagram: "ig-1", facebook: "fb-1" },
      publicBaseUrl: "https://cdn.example.com",
    });
    const res = await pub.publish("/x.mp4", "c", ["instagram", "facebook"]);
    expect(res[0]).toEqual({ platform: "instagram", ok: true });
    expect(res[1]?.ok).toBe(false);
    expect(res[1]?.error).toContain("429");
  });

  it("fails a platform with no configured accountId", async () => {
    stubFetch(() => ({ ok: true, json: {} }));
    const pub = new BlotatoPublisher({ apiKey: "k", publicBaseUrl: "https://cdn.example.com" });
    const res = await pub.publish("/x.mp4", "c", ["instagram"]);
    expect(res[0]?.ok).toBe(false);
    expect(res[0]?.error).toContain("no Blotato accountId");
  });
});
