import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { PublishResult, PublishResultItem, PublishTarget, Publisher } from "./publisher.js";

// NOTE: Built to Blotato's documented shape (blotato-api-key header, /v2/posts with
// post.accountId + content.text + content.mediaUrls, /v2/media for upload). The exact
// schema MUST be confirmed with a real call when going live (USE_MOCK_PUBLISHER=false)
// using real per-platform account ids from the Blotato dashboard. Adjust `buildPostBody`
// + the matching test together if the live API differs.

export interface BlotatoConfig {
  apiKey: string;
  baseUrl?: string;
  /** Blotato account ids per platform (from the Blotato dashboard). */
  accountIds?: Partial<Record<PublishTarget, string>>;
  /** Facebook Page id (required by Blotato for facebook targets). */
  facebookPageId?: string;
  /** TikTok privacy level (default PUBLIC_TO_EVERYONE). */
  tiktokPrivacyLevel?: string;
  /** If set, the rendered MP4 is served from here instead of uploaded to Blotato. */
  publicBaseUrl?: string;
}

export class BlotatoPublisher implements Publisher {
  private readonly apiKey: string;
  private readonly base: string;
  private readonly accountIds: Partial<Record<PublishTarget, string>>;
  private readonly facebookPageId?: string;
  private readonly tiktokPrivacyLevel: string;
  private readonly publicBaseUrl?: string;

  constructor(cfg: BlotatoConfig) {
    this.apiKey = cfg.apiKey;
    this.base = cfg.baseUrl ?? "https://backend.blotato.com";
    this.accountIds = cfg.accountIds ?? {};
    this.tiktokPrivacyLevel = cfg.tiktokPrivacyLevel ?? "PUBLIC_TO_EVERYONE";
    if (cfg.facebookPageId) this.facebookPageId = cfg.facebookPageId;
    if (cfg.publicBaseUrl) this.publicBaseUrl = cfg.publicBaseUrl;
  }

  /** Per-platform target object per the Blotato publish schema. */
  private targetFor(platform: PublishTarget): Record<string, unknown> {
    if (platform === "facebook") {
      if (!this.facebookPageId) throw new Error("no Blotato facebookPageId configured");
      return { targetType: "facebook", pageId: this.facebookPageId };
    }
    if (platform === "tiktok") {
      return {
        targetType: "tiktok",
        privacyLevel: this.tiktokPrivacyLevel,
        disabledComments: false,
        disabledDuet: false,
        disabledStitch: false,
        isBrandedContent: false,
        isYourBrand: false,
        isAiGenerated: true, // content is AI-generated — required TikTok disclosure
      };
    }
    return { targetType: "instagram" };
  }

  async publish(
    videoPath: string,
    caption: string,
    targets: PublishTarget[],
  ): Promise<PublishResult> {
    let mediaUrl: string;
    try {
      mediaUrl = await this.resolveMediaUrl(videoPath);
    } catch (e) {
      return targets.map((platform) => ({ platform, ok: false, error: `media: ${String(e)}` }));
    }
    const results: PublishResultItem[] = [];
    for (const platform of targets) {
      try {
        const accountId = this.accountIds[platform];
        if (!accountId) throw new Error(`no Blotato accountId configured for ${platform}`);
        await this.fetchJson(
          "/v2/posts",
          JSON.stringify(this.buildPostBody(platform, accountId, caption, mediaUrl)),
        );
        results.push({ platform, ok: true });
      } catch (e) {
        results.push({ platform, ok: false, error: String(e) });
      }
    }
    return results;
  }

  private buildPostBody(
    platform: PublishTarget,
    accountId: string,
    text: string,
    mediaUrl: string,
  ) {
    return {
      post: {
        accountId,
        target: this.targetFor(platform),
        content: { platform, text, mediaUrls: [mediaUrl] },
      },
    };
  }

  private async resolveMediaUrl(videoPath: string): Promise<string> {
    if (/^https?:\/\//.test(videoPath)) return videoPath;
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl.replace(/\/$/, "")}/media/${basename(videoPath)}`;
    }
    // upload the local file to Blotato's media endpoint
    const buf = await readFile(videoPath);
    const res = (await this.fetchJson("/v2/media", buf, "application/octet-stream")) as {
      url: string;
    };
    return res.url;
  }

  private async fetchJson(
    path: string,
    body: string | Uint8Array,
    contentType = "application/json",
  ) {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { "blotato-api-key": this.apiKey, "content-type": contentType },
      body,
    });
    if (!res.ok) throw new Error(`Blotato ${path} ${res.status}: ${await res.text()}`);
    return res.json();
  }
}
