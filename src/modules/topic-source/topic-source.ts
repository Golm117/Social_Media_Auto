// Picks a daily coding topic from the most-upvoted Stack Overflow questions for a
// language tag. The top-voted questions per tag are the canonical, evergreen ones
// ("What is the difference between let and var?") — a perfect fit for the
// advanced-beginner audience. The operator still approves every resulting draft.

export interface Topic {
  /** Stable source id, used to avoid drafting the same topic twice. */
  id: string;
  question: string;
}

export interface TopicSource {
  /** The best unused topic for `language`, or null if none of the candidates are fresh. */
  nextTopic(language: string, excludeIds: string[]): Promise<Topic | null>;
}

interface StackOverflowItem {
  question_id: number;
  title: string;
  score: number;
  is_answered: boolean;
}

const NAMED_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

/** Stack Overflow titles arrive HTML-escaped (&quot;, &#39;, &#252; …). */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&[a-z]+;|&#39;/gi, (m) => NAMED_ENTITIES[m.toLowerCase()] ?? m);
}

export interface StackOverflowConfig {
  /** Optional StackExchange API key — lifts the per-day quota; not required for 1 call/day. */
  apiKey?: string;
  /** How many top questions to fetch and choose from (default 30). */
  pageSize?: number;
  baseUrl?: string;
}

export class StackOverflowTopicSource implements TopicSource {
  private readonly apiKey: string | undefined;
  private readonly pageSize: number;
  private readonly base: string;

  constructor(cfg: StackOverflowConfig = {}) {
    this.apiKey = cfg.apiKey;
    this.pageSize = cfg.pageSize ?? 30;
    this.base = cfg.baseUrl ?? "https://api.stackexchange.com/2.3";
  }

  async nextTopic(language: string, excludeIds: string[]): Promise<Topic | null> {
    const exclude = new Set(excludeIds);
    const params = new URLSearchParams({
      order: "desc",
      sort: "votes",
      tagged: language,
      site: "stackoverflow",
      pagesize: String(this.pageSize),
    });
    if (this.apiKey) params.set("key", this.apiKey);

    const res = await fetch(`${this.base}/questions?${params}`);
    if (!res.ok) throw new Error(`Stack Overflow ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { items?: StackOverflowItem[] };

    for (const item of data.items ?? []) {
      const id = String(item.question_id);
      if (exclude.has(id)) continue;
      if (!item.is_answered || item.score <= 0) continue;
      const title = decodeEntities(item.title).trim();
      if (!title.includes("?")) continue; // skip non-question titles
      return { id, question: title };
    }
    return null;
  }
}
