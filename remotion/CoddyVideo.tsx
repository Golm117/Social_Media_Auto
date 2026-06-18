import { AbsoluteFill, Audio, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { CoddyVideoProps } from "../src/modules/video-composer/coddy-props";
import { Background } from "./components/Background";
import { Captions } from "./components/Captions";
import { Coddy } from "./components/Coddy";
import { CodePanel } from "./components/CodePanel";
import { EndCard } from "./components/EndCard";

export const CoddyVideo = (props: CoddyVideoProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  return (
    <AbsoluteFill style={{ backgroundColor: "#0d0221" }}>
      <Background hook={props.hook} />
      <CodePanel steps={props.steps} ms={ms} durationMs={props.durationMs} />
      <Coddy track={props.mascotTrack} sheetSrc={props.mascotSheetSrc} ms={ms} />
      <Captions timings={props.timings} ms={ms} />
      <EndCard
        contentDurationMs={props.durationMs}
        endCardMs={props.endCardMs}
        brandHandle={props.brandHandle}
      />
      {props.audioSrc ? <Audio src={staticFile(props.audioSrc)} /> : null}
      {/* background music: quiet bed under the voiceover */}
      {props.musicSrc ? <Audio src={staticFile(props.musicSrc)} volume={0.07} loop /> : null}
    </AbsoluteFill>
  );
};
