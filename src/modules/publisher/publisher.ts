// TODO (later slice): BlotatoPublisher — Blotato /v2/posts, takes a public mediaUrl

// ─── Types ──────────────────────────────────────────────────────────────────

export type PublishTarget = "instagram" | "facebook" | "tiktok";

export interface PublishResultItem {
  platform: PublishTarget;
  ok: boolean;
  error?: string;
}

export type PublishResult = PublishResultItem[];

export interface Publisher {
  publish(videoPath: string, caption: string, targets: PublishTarget[]): Promise<PublishResult>;
}

// ─── MockPublisher ───────────────────────────────────────────────────────────

type BehaviorConfig = Partial<Record<PublishTarget, { ok: boolean; error?: string }>>;

interface PublishCall {
  videoPath: string;
  caption: string;
  targets: PublishTarget[];
}

export class MockPublisher implements Publisher {
  private readonly config: BehaviorConfig;
  private readonly _calls: PublishCall[] = [];

  get calls(): ReadonlyArray<PublishCall> {
    return this._calls;
  }

  constructor(config: BehaviorConfig = {}) {
    this.config = config;
  }

  async publish(
    videoPath: string,
    caption: string,
    targets: PublishTarget[],
  ): Promise<PublishResult> {
    this._calls.push({ videoPath, caption, targets });
    return targets.map((platform): PublishResultItem => {
      const behavior = this.config[platform];
      if (behavior === undefined) {
        return { platform, ok: true };
      }
      if (behavior.error !== undefined) {
        return { platform, ok: behavior.ok, error: behavior.error };
      }
      return { platform, ok: behavior.ok };
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function allPublished(result: PublishResult): boolean {
  return result.every((item) => item.ok);
}

const BRAND_TAG = "CodeWithQuirk";

/**
 * Assemble the final post text: caption + CTA + hashtags (with `#`).
 * Ensures the branded #CodeWithQuirk tag is present, dedupes, and normalizes `#`.
 */
export function composeCaption(
  socialCaption: string,
  hashtags: string[],
  brandHandle = "@CodeWithQuirk",
): string {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of [...hashtags, BRAND_TAG]) {
    const h = raw.replace(/^#/, "").replace(/\s+/g, "");
    const key = h.toLowerCase();
    if (!h || seen.has(key)) continue;
    seen.add(key);
    tags.push(`#${h}`);
  }
  const cta = `💻 Follow ${brandHandle} for daily dev tips!`;
  return [socialCaption.trim(), cta, tags.join(" ")].filter(Boolean).join("\n\n");
}
