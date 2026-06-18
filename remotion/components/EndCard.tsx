import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { endCardOpacity } from "../../src/modules/video-composer/coddy-props";
import { PIXEL_FONT } from "./font";

interface EndCardProps {
  /** Length of the content portion; the card occupies the trailing window after it. */
  contentDurationMs: number;
  endCardMs: number;
  brandHandle: string;
}

// A retro "Like & Follow" finale that fades in once the lesson ends. Matches the
// channel palette: deep-purple ground, cyan/pink neon, Press Start 2P display type.
export const EndCard = ({ contentDurationMs, endCardMs, brandHandle }: EndCardProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  const opacity = endCardOpacity(ms, contentDurationMs, endCardMs);
  if (opacity <= 0) return null;

  // pop-in once the card starts
  const startFrame = Math.round((contentDurationMs / 1000) * fps);
  const pop = spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 12, stiffness: 120 },
  });

  return (
    <AbsoluteFill
      style={{
        opacity,
        backgroundColor: "rgba(13,2,33,0.92)",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        fontFamily: PIXEL_FONT,
      }}
    >
      <div style={{ transform: `scale(${0.6 + 0.4 * pop})` }}>
        <div style={{ fontSize: 150, lineHeight: 1, marginBottom: 36 }}>👍</div>
        <div
          style={{
            color: "#fdf6e3",
            fontSize: 64,
            lineHeight: 1.5,
            textShadow: "4px 4px 0 #ff2e88",
          }}
        >
          LIKE
          <br />&<br />
          FOLLOW
        </div>
        <div
          style={{
            marginTop: 56,
            border: "6px solid #36f9f6",
            boxShadow: "0 0 0 6px #0d0221, 0 0 28px rgba(54,249,246,0.5)",
            background: "#1a0b3a",
            display: "inline-block",
            padding: "22px 30px",
            color: "#36f9f6",
            fontSize: 40,
            letterSpacing: 2,
          }}
        >
          {brandHandle}
        </div>
        <div style={{ marginTop: 40, color: "#fdf6e3", fontSize: 24, letterSpacing: 1 }}>
          for more dev tips
        </div>
      </div>
    </AbsoluteFill>
  );
};
