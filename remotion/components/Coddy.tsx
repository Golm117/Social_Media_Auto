import { Img, staticFile } from "remotion";
import {
  type CoddyMascotTrack,
  frameAt,
  segmentAt,
} from "../../src/modules/video-composer/coddy-props";

const SCALE = 2.2;

// Coddy's feet are planted at this point (atlas anchor is "bottom-center").
// Frame crops are tight boxes of varying size, so each frame must be centered
// on ANCHOR_X with its bottom edge pinned — otherwise Coddy's body sways and
// grows around the box corner instead of standing still on his feet.
// ANCHOR_X keeps the widest frame (156px × SCALE) left of the speech bubble (x=372).
const ANCHOR_X = 210;
const ANCHOR_BOTTOM = 96;

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
  const seg = segmentAt(track, ms);
  if (!f || !seg) return null;
  // Sprites in an emotion row share a ground line in the sheet, but the tight
  // crops' bottoms can sit a few px above it — lift such frames so the FEET
  // (row baseline), not the crop box, stay pinned to ANCHOR_BOTTOM.
  const rowBaseline = Math.max(...seg.frames.map((fr) => fr.y + fr.h));
  const lift = (rowBaseline - (f.y + f.h)) * SCALE;
  return (
    <div
      style={{
        position: "absolute",
        bottom: ANCHOR_BOTTOM + lift,
        left: ANCHOR_X - (f.w * SCALE) / 2,
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
