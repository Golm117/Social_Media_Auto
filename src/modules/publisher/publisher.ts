// ─── Types ──────────────────────────────────────────────────────────────────

export type PublishTarget = "instagram" | "facebook" | "tiktok";

/** Per-platform post text (each platform can get a tailored caption). */
export type PostCaptions = Partial<Record<PublishTarget, string>>;

export interface PublishResultItem {
  platform: PublishTarget;
  ok: boolean;
  error?: string;
}

export type PublishResult = PublishResultItem[];

export interface Publisher {
  /** Media is uploaded once; each target is posted with its own caption from `captions`. */
  publish(
    videoPath: string,
    captions: PostCaptions,
    targets: PublishTarget[],
  ): Promise<PublishResult>;
}

// ─── MockPublisher ───────────────────────────────────────────────────────────

type BehaviorConfig = Partial<Record<PublishTarget, { ok: boolean; error?: string }>>;

interface PublishCall {
  videoPath: string;
  captions: PostCaptions;
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
    captions: PostCaptions,
    targets: PublishTarget[],
  ): Promise<PublishResult> {
    this._calls.push({ videoPath, captions, targets });
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

// Per-platform style: hashtag count + whether to trim the caption to a punchy first line.
const PLATFORM_STYLE: Record<PublishTarget, { maxTags: number; punchy: boolean }> = {
  instagram: { maxTags: 8, punchy: false },
  facebook: { maxTags: 3, punchy: false }, // FB: hashtags add little, keep it light
  tiktok: { maxTags: 4, punchy: true }, // TikTok: short & punchy, few tags
};

export interface CaptionOptions {
  brandHandle?: string;
  platform?: PublishTarget;
}

/**
 * Assemble the final post text for a platform: caption (+ punchy trim for TikTok) + CTA +
 * hashtags (with `#`), platform-appropriate hashtag count, always incl. branded #CodeWithQuirk.
 */
export function composeCaption(
  socialCaption: string,
  hashtags: string[],
  opts: CaptionOptions = {},
): string {
  const brandHandle = opts.brandHandle ?? "@CodeWithQuirk";
  const style = (opts.platform && PLATFORM_STYLE[opts.platform]) || { maxTags: 8, punchy: false };

  let body = socialCaption.trim();
  if (style.punchy) {
    // first sentence only, for a snappy TikTok caption
    body = body.split(/(?<=[.!?])\s+/)[0] ?? body;
  }

  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of [BRAND_TAG, ...hashtags]) {
    const h = raw.replace(/^#/, "").replace(/\s+/g, "");
    const key = h.toLowerCase();
    if (!h || seen.has(key)) continue;
    seen.add(key);
    tags.push(`#${h}`);
    if (tags.length >= style.maxTags) break;
  }

  const cta = `💻 Follow ${brandHandle} for daily dev tips!`;
  return [body, cta, tags.join(" ")].filter(Boolean).join("\n\n");
}
