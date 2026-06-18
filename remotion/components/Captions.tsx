import {
  type CoddyWordTiming,
  activeWordIndex,
} from "../../src/modules/video-composer/coddy-props";

// Speech bubble anchored to Coddy (bottom-left). Shows a short rolling window of the
// narration with the current word highlighted, so it reads like he's talking.
export const Captions = ({ timings, ms }: { timings: CoddyWordTiming[]; ms: number }) => {
  if (timings.length === 0) return null;

  let cur = activeWordIndex(timings, ms);
  if (cur < 0) {
    // hold the most recently spoken word through short gaps (no flicker)
    for (let k = 0; k < timings.length; k++) {
      if ((timings[k]?.endMs ?? 0) <= ms) cur = k;
      else break;
    }
  }
  if (cur < 0) return null; // narration hasn't started yet

  const start = Math.max(0, cur - 3);
  const windowWords = timings.slice(start, cur + 1);

  return (
    <div style={{ position: "absolute", left: 372, right: 56, bottom: 232 }}>
      <div
        style={{
          position: "relative",
          background: "#fdf6e3",
          border: "5px solid #36f9f6",
          borderRadius: 20,
          padding: "22px 26px",
          boxShadow: "7px 7px 0 rgba(0,0,0,0.45)",
        }}
      >
        {/* tail pointing down-left toward Coddy */}
        <div
          style={{
            position: "absolute",
            left: -24,
            bottom: 26,
            width: 0,
            height: 0,
            borderTop: "16px solid transparent",
            borderBottom: "16px solid transparent",
            borderRight: "26px solid #36f9f6",
          }}
        />
        <div
          style={{
            fontFamily: "monospace",
            fontWeight: 800,
            fontSize: 46,
            lineHeight: 1.25,
            color: "#5a4b8a",
          }}
        >
          {windowWords.map((w, idx) => {
            const isCurrent = start + idx === cur;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional render, stable per frame
              <span key={idx} style={{ color: isCurrent ? "#ff2e88" : "#5a4b8a" }}>
                {w.word}{" "}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};
