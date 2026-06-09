import {
  type CoddyWordTiming,
  activeWordIndex,
} from "../../src/modules/video-composer/coddy-props";

export const Captions = ({ timings, ms }: { timings: CoddyWordTiming[]; ms: number }) => {
  if (timings.length === 0) return null;
  const i = activeWordIndex(timings, ms);
  const word = i >= 0 ? (timings[i]?.word ?? "") : "";
  if (!word) return null;
  return (
    <div style={{ position: "absolute", bottom: 600, left: 56, right: 56, textAlign: "center" }}>
      <span
        style={{
          display: "inline-block",
          fontFamily: "monospace",
          fontWeight: 800,
          fontSize: 72,
          color: "#ffffff",
          background: "#ff2e88",
          padding: "10px 26px",
          borderRadius: 10,
          textTransform: "uppercase",
          boxShadow: "0 0 0 5px #0d0221, 6px 6px 0 #36f9f6",
        }}
      >
        {word}
      </span>
    </div>
  );
};
