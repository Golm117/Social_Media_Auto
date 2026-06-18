import { AbsoluteFill } from "remotion";
import { PIXEL_FONT } from "./font";

export const Background = ({ hook }: { hook: string }) => (
  <AbsoluteFill>
    {/* CRT scanlines */}
    <AbsoluteFill
      style={{
        backgroundImage:
          "repeating-linear-gradient(rgba(255,255,255,0.04) 0 2px, transparent 2px 5px)",
      }}
    />
    {/* hook title box (retro chrome) */}
    <div style={{ position: "absolute", top: 90, left: 56, right: 56 }}>
      <div
        style={{
          border: "6px solid #36f9f6",
          boxShadow: "0 0 0 6px #0d0221, 0 0 28px rgba(54,249,246,0.5)",
          background: "#1a0b3a",
          padding: "28px 32px",
          color: "#fdf6e3",
          // Press Start 2P renders ~2x wider than mono — smaller size, looser leading
          fontFamily: PIXEL_FONT,
          fontSize: 38,
          lineHeight: 1.45,
          textShadow: "3px 3px 0 #ff2e88",
        }}
      >
        {hook}
      </div>
    </div>
    {/* brand CTA strip */}
    <div
      style={{
        position: "absolute",
        bottom: 36,
        width: "100%",
        textAlign: "center",
        color: "#36f9f6",
        fontFamily: PIXEL_FONT,
        fontSize: 24,
        letterSpacing: 2,
      }}
    >
      ▸ Follow @CodeWithQuirk
    </div>
  </AbsoluteFill>
);
