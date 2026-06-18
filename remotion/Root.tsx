import { Composition } from "remotion";
import {
  type CoddyVideoProps,
  END_CARD_MS,
  VIDEO_FPS,
} from "../src/modules/video-composer/coddy-props";
import { CoddyVideo } from "./CoddyVideo";

/** Total composition length = content + the trailing end card. */
const totalFrames = (p: { durationMs: number; endCardMs: number; fps: number }) =>
  Math.max(1, Math.round(((p.durationMs + p.endCardMs) / 1000) * p.fps));

const defaultProps: CoddyVideoProps = {
  hook: "Still writing for-loops like it's 2010?",
  templateId: "x-in-3-steps",
  steps: [],
  timings: [],
  audioSrc: "audio.mp3",
  mascotSheetSrc: "coddy-sheet.png",
  mascotTrack: {
    image: "coddy-sheet.png",
    anchor: "bottom-center",
    sheetSize: { w: 1432, h: 1432 },
    totalMs: 3000,
    segments: [],
  },
  durationMs: 3000,
  endCardMs: END_CARD_MS,
  brandHandle: "@CodeWithQuirk",
  fps: VIDEO_FPS,
};

export const RemotionRoot = () => (
  <Composition
    id="CoddyVideo"
    component={CoddyVideo}
    width={1080}
    height={1920}
    fps={VIDEO_FPS}
    durationInFrames={totalFrames(defaultProps)}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: totalFrames(props),
      fps: props.fps,
    })}
  />
);
