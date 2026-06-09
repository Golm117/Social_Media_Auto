import {
  type HighlightedLine,
  activeStepIndex,
} from "../../src/modules/video-composer/coddy-props";

interface Step {
  text: string;
  codeLines?: HighlightedLine[];
  language?: string;
}

// The code lives in a bounded region that ends ABOVE Coddy + his speech bubble, so they
// never overlap. The code font auto-fits: short snippets stay large, long ones shrink just
// enough to fit (nothing is clipped). The code window is never made smaller than needed.
const REGION_TOP = 440;
const REGION_BOTTOM = 560; // reserve the bottom band for Coddy + bubble
const REGION_HEIGHT = 1920 - REGION_TOP - REGION_BOTTOM;
const CHROME = 110; // window border/padding + header + step-text margin
const MAX_CODE_FONT = 34;
const MIN_CODE_FONT = 18;

export const CodePanel = ({
  steps,
  ms,
  durationMs,
}: {
  steps: Step[];
  ms: number;
  durationMs: number;
}) => {
  if (steps.length === 0) return null;
  const i = activeStepIndex(steps.length, ms, durationMs);
  const step = steps[i];
  if (!step) return null;

  const codeLines = step.codeLines ?? [];
  // estimate the step-narration height (wraps at ~34 chars/line)
  const stepTextLines = Math.max(1, Math.ceil(step.text.length / 34));
  const stepFont = 36;
  const stepH = stepTextLines * stepFont * 1.25 + 22;
  const availForCode = REGION_HEIGHT - stepH - CHROME;
  const codeFont =
    codeLines.length > 0
      ? Math.max(
          MIN_CODE_FONT,
          Math.min(MAX_CODE_FONT, Math.floor(availForCode / (codeLines.length * 1.5))),
        )
      : MAX_CODE_FONT;

  return (
    <div
      style={{
        position: "absolute",
        top: REGION_TOP,
        left: 56,
        right: 56,
        height: REGION_HEIGHT,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          color: "#ffd866",
          fontFamily: "monospace",
          fontWeight: 700,
          fontSize: stepFont,
          marginBottom: 20,
          lineHeight: 1.25,
        }}
      >
        {step.text}
      </div>
      {codeLines.length > 0 ? (
        <div
          style={{
            border: "5px solid #6b5bd2",
            borderRadius: 10,
            background: "#160d2e",
            boxShadow: "0 0 24px rgba(0,0,0,0.5)",
            padding: "22px 28px",
          }}
        >
          <div
            style={{ marginBottom: 12, color: "#7a6fb0", fontFamily: "monospace", fontSize: 22 }}
          >
            ● ● ●&nbsp;&nbsp;{step.language ?? ""}
          </div>
          <pre
            style={{
              margin: 0,
              fontFamily: "'Fira Code', 'JetBrains Mono', Menlo, Consolas, monospace",
              fontSize: codeFont,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {codeLines.map((line, li) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional render, stable per frame
              <div key={li}>
                {line.length === 0
                  ? " "
                  : line.map((tok, ti) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional render, stable per frame
                      <span key={ti} style={{ color: tok.color }}>
                        {tok.content}
                      </span>
                    ))}
              </div>
            ))}
          </pre>
        </div>
      ) : null}
    </div>
  );
};
