import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  type CharAlignment,
  DefaultVoiceSynthesizer,
  type TtsClient,
  charsToWordTimings,
} from "./voice-synthesizer.js";

describe("charsToWordTimings", () => {
  it("groups characters into words with start/end ms", () => {
    // "Hi there" — chars H i _ t h e r e
    const alignment: CharAlignment = {
      characters: ["H", "i", " ", "t", "h", "e", "r", "e"],
      startTimesSec: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
      endTimesSec: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    };
    expect(charsToWordTimings(alignment)).toEqual([
      { word: "Hi", startMs: 0, endMs: 200 },
      { word: "there", startMs: 300, endMs: 800 },
    ]);
  });

  it("ignores leading/trailing/multiple spaces", () => {
    const alignment: CharAlignment = {
      characters: [" ", "a", " ", " ", "b", " "],
      startTimesSec: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
      endTimesSec: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    };
    expect(charsToWordTimings(alignment)).toEqual([
      { word: "a", startMs: 100, endMs: 200 },
      { word: "b", startMs: 400, endMs: 500 },
    ]);
  });

  it("returns empty for no content", () => {
    expect(charsToWordTimings({ characters: [], startTimesSec: [], endTimesSec: [] })).toEqual([]);
  });
});

describe("DefaultVoiceSynthesizer", () => {
  const outDir = join(tmpdir(), `coddy-voice-test-${process.pid}`);
  afterAll(() => rm(outDir, { recursive: true, force: true }));

  const mockClient: TtsClient = {
    async synthesize() {
      return {
        audio: Buffer.from("FAKE_MP3_BYTES"),
        alignment: {
          characters: ["h", "i"],
          startTimesSec: [0, 0.1],
          endTimesSec: [0.1, 0.2],
        },
      };
    },
  };

  it("writes the audio file and returns a path + word timings", async () => {
    const synth = new DefaultVoiceSynthesizer(mockClient, outDir);
    const result = await synth.synthesize("hi");
    expect(result.audioPath.endsWith(".mp3")).toBe(true);
    expect(result.timings).toEqual([{ word: "hi", startMs: 0, endMs: 200 }]);
    // file actually exists with the audio bytes
    const written = await readFile(result.audioPath);
    expect(written.toString()).toBe("FAKE_MP3_BYTES");
  });
});
