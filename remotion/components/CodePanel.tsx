import {
  type HighlightedLine,
  activeStepIndex,
} from "../../src/modules/video-composer/coddy-props";

interface Step {
  text: string;
  codeLines?: HighlightedLine[];
  language?: string;
}

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

  return (
    <div style={{ position: "absolute", top: 470, left: 56, right: 56 }}>
      {/* step narration text */}
      <div
        style={{
          color: "#ffd866",
          fontFamily: "monospace",
          fontWeight: 700,
          fontSize: 40,
          marginBottom: 20,
          lineHeight: 1.2,
        }}
      >
        {step.text}
      </div>
      {/* code window */}
      {step.codeLines && step.codeLines.length > 0 ? (
        <div
          style={{
            border: "5px solid #6b5bd2",
            borderRadius: 10,
            background: "#160d2e",
            boxShadow: "0 0 24px rgba(0,0,0,0.5)",
            padding: "26px 30px",
          }}
        >
          <div
            style={{ marginBottom: 14, color: "#7a6fb0", fontFamily: "monospace", fontSize: 24 }}
          >
            ● ● ●&nbsp;&nbsp;{step.language ?? ""}
          </div>
          <pre
            style={{
              margin: 0,
              fontFamily: "'Fira Code', 'JetBrains Mono', Menlo, Consolas, monospace",
              fontSize: 36,
              lineHeight: 1.45,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {step.codeLines.map((line, li) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: token positions are stable per render
              <div key={li}>
                {line.length === 0
                  ? " "
                  : line.map((tok, ti) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: token positions are stable per render
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
