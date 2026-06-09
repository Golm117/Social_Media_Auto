import { Composition } from "remotion";
import { type CoddyVideoProps, VIDEO_FPS } from "../src/modules/video-composer/coddy-props";
import { CoddyVideo } from "./CoddyVideo";

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
  fps: VIDEO_FPS,
};

export const RemotionRoot = () => (
  <Composition
    id="CoddyVideo"
    component={CoddyVideo}
    width={1080}
    height={1920}
    fps={VIDEO_FPS}
    durationInFrames={Math.round((defaultProps.durationMs / 1000) * VIDEO_FPS)}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.max(1, Math.round((props.durationMs / 1000) * props.fps)),
      fps: props.fps,
    })}
  />
);
