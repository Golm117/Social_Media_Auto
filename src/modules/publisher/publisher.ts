// TODO (later slice): BlotatoPublisher — Blotato /v2/posts, takes a public mediaUrl

// ─── Types ──────────────────────────────────────────────────────────────────

export type PublishTarget = "instagram" | "facebook";

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
