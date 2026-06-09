import { Img, staticFile } from "remotion";
import { type CoddyMascotTrack, frameAt } from "../../src/modules/video-composer/coddy-props";

const SCALE = 2.2;

// Coddy stands in the bottom-LEFT corner; his speech bubble (Captions) sits to his right.
export const Coddy = ({
  track,
  sheetSrc,
  ms,
}: {
  track: CoddyMascotTrack;
  sheetSrc: string;
  ms: number;
}) => {
  const f = frameAt(track, ms);
  if (!f) return null;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 96,
        left: 48,
        width: f.w * SCALE,
        height: f.h * SCALE,
        overflow: "hidden",
        imageRendering: "pixelated",
      }}
    >
      <Img
        src={staticFile(sheetSrc)}
        style={{
          position: "absolute",
          left: -f.x * SCALE,
          top: -f.y * SCALE,
          width: track.sheetSize.w * SCALE,
          height: track.sheetSize.h * SCALE,
          maxWidth: "none",
          imageRendering: "pixelated",
        }}
      />
    </div>
  );
};
