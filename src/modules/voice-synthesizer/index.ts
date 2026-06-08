// TODO: slice 6
export interface VoiceSynthesizer {
  synthesize(text: string): Promise<{
    audioPath: string;
    timings: Array<{ word: string; startMs: number; endMs: number }>;
  }>;
}
