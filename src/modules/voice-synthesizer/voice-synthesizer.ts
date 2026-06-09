import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface SynthesisResult {
  audioPath: string;
  timings: WordTiming[];
}

export interface VoiceSynthesizer {
  synthesize(text: string): Promise<SynthesisResult>;
}

/** Character-level alignment as returned by ElevenLabs with-timestamps. */
export interface CharAlignment {
  characters: string[];
  startTimesSec: number[];
  endTimesSec: number[];
}

/** Injectable boundary. Real impl calls ElevenLabs; tests mock it. */
export interface TtsClient {
  synthesize(text: string): Promise<{ audio: Buffer; alignment: CharAlignment }>;
}

// ─── Pure: char alignment → word timings ────────────────────────────────────

export function charsToWordTimings(alignment: CharAlignment): WordTiming[] {
  const { characters, startTimesSec, endTimesSec } = alignment;
  const words: WordTiming[] = [];
  let current = "";
  let wordStart: number | null = null;
  let wordEnd = 0;

  const flush = () => {
    if (current.length > 0 && wordStart !== null) {
      words.push({
        word: current,
        startMs: Math.round(wordStart * 1000),
        endMs: Math.round(wordEnd * 1000),
      });
    }
    current = "";
    wordStart = null;
  };

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i] ?? "";
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    if (wordStart === null) wordStart = startTimesSec[i] ?? wordEnd;
    current += ch;
    wordEnd = endTimesSec[i] ?? wordEnd;
  }
  flush();
  return words;
}

// ─── ElevenLabs real adapter ────────────────────────────────────────────────
// Validated live against the ElevenLabs with-timestamps endpoint.

export interface ElevenLabsConfig {
  apiKey: string;
  voiceId: string;
  modelId?: string; // default eleven_multilingual_v2
}

export class ElevenLabsTtsClient implements TtsClient {
  private readonly apiKey: string;
  private readonly voiceId: string;
  private readonly modelId: string;

  constructor({ apiKey, voiceId, modelId }: ElevenLabsConfig) {
    this.apiKey = apiKey;
    this.voiceId = voiceId;
    this.modelId = modelId ?? "eleven_multilingual_v2";
  }

  async synthesize(text: string): Promise<{ audio: Buffer; alignment: CharAlignment }> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/with-timestamps`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: this.modelId }),
    });
    if (!res.ok) {
      throw new Error(`ElevenLabs TTS failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      audio_base64: string;
      alignment: {
        characters: string[];
        character_start_times_seconds: number[];
        character_end_times_seconds: number[];
      };
    };
    return {
      audio: Buffer.from(data.audio_base64, "base64"),
      alignment: {
        characters: data.alignment.characters,
        startTimesSec: data.alignment.character_start_times_seconds,
        endTimesSec: data.alignment.character_end_times_seconds,
      },
    };
  }
}

// ─── DefaultVoiceSynthesizer ────────────────────────────────────────────────

export class DefaultVoiceSynthesizer implements VoiceSynthesizer {
  constructor(
    private readonly client: TtsClient,
    private readonly outputDir: string,
  ) {}

  async synthesize(text: string): Promise<SynthesisResult> {
    const { audio, alignment } = await this.client.synthesize(text);
    await mkdir(this.outputDir, { recursive: true });
    const name = `${createHash("sha1").update(text).digest("hex").slice(0, 16)}.mp3`;
    const audioPath = join(this.outputDir, name);
    await writeFile(audioPath, audio);
    return { audioPath, timings: charsToWordTimings(alignment) };
  }
}
