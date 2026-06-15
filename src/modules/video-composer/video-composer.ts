import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { codeToTokens } from "shiki";
import {
  type CoddyMascotTrack,
  type CoddyVideoProps,
  type ComposeInput,
  type HighlightedLine,
  VIDEO_FPS,
  type VideoComposer,
  computeDurationMs,
} from "./coddy-props.js";

export * from "./coddy-props.js";

const SHIKI_THEME = "dracula";

const HIGHLIGHT_LANGS = ["javascript", "typescript", "python", "sql", "css"] as const;
type HighlightLang = (typeof HIGHLIGHT_LANGS)[number];

async function highlight(code: string, lang: string): Promise<HighlightedLine[]> {
  const safeLang = (HIGHLIGHT_LANGS as readonly string[]).includes(lang) ? lang : "text";
  const { tokens } = await codeToTokens(code, {
    lang: safeLang as HighlightLang,
    theme: SHIKI_THEME,
  });
  return tokens.map((line) =>
    line.map((t) => ({ content: t.content, color: t.color ?? "#f8f8f2" })),
  );
}

export class DefaultVideoComposer implements VideoComposer {
  // Renders are serialized: concurrent renders would clobber the shared per-process
  // public dir and contend for CPU (each render runs headless Chrome + encoding).
  private queue: Promise<unknown> = Promise.resolve();

  compose(input: ComposeInput): Promise<{ videoPath: string }> {
    const run = this.queue.then(() => this.doCompose(input));
    this.queue = run.catch(() => {});
    return run;
  }

  private async doCompose(input: ComposeInput): Promise<{ videoPath: string }> {
    const { scriptPackage, audioPath, mascotTrackPath, timings, mascotSheetPath, outputPath } =
      input;

    const track = JSON.parse(await readFile(mascotTrackPath, "utf8")) as CoddyMascotTrack;

    const steps = await Promise.all(
      scriptPackage.bodySteps.map(async (s) => ({
        text: s.text,
        language: s.language,
        codeLines: s.code && s.language ? await highlight(s.code, s.language) : undefined,
      })),
    );

    const publicDir = join(dirname(outputPath), `.remotion-public-${process.pid}`);
    await mkdir(publicDir, { recursive: true });
    await cp(audioPath, join(publicDir, "audio.mp3"));
    await cp(mascotSheetPath, join(publicDir, "coddy-sheet.png"));

    const props: CoddyVideoProps = {
      hook: scriptPackage.hook,
      templateId: scriptPackage.templateId,
      steps,
      timings,
      audioSrc: "audio.mp3",
      mascotSheetSrc: "coddy-sheet.png",
      mascotTrack: track,
      durationMs: computeDurationMs(track, timings),
      fps: VIDEO_FPS,
    };
    if (input.musicPath) {
      await cp(input.musicPath, join(publicDir, "music.mp3"));
      props.musicSrc = "music.mp3";
    }

    const inputProps: Record<string, unknown> = props;
    const here = dirname(fileURLToPath(import.meta.url));
    const entry = resolve(here, "../../../remotion/index.ts");
    try {
      const serveUrl = await bundle({ entryPoint: entry, publicDir });
      const composition = await selectComposition({ serveUrl, id: "CoddyVideo", inputProps });
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation: outputPath,
        inputProps,
      });
      return { videoPath: outputPath };
    } finally {
      await rm(publicDir, { recursive: true, force: true });
    }
  }
}
