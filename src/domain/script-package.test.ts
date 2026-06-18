import { describe, expect, it } from "vitest";
import { ScriptPackageSchema } from "./script-package.js";

const VALID_PACKAGE = {
  templateId: "fix-this-error",
  hook: "This one bug took me 3 hours to find.",
  bodySteps: [
    { text: "The error message was misleading" },
    {
      text: "The real culprit was a type coercion",
      code: "const x = '5' + 1;",
      language: "javascript",
    },
  ],
  voiceoverText: "Here is how I finally tracked it down.",
  captionsText: "Bug hunt: type coercion edition",
  socialCaption: "This bug was hiding in plain sight 🐛",
  hashtags: ["javascript", "debugging"],
  coverSpec: { title: "Fix This Error", subtitle: "Type coercion trap" },
  mascotCues: [
    { state: "intro", atStep: -1 },
    { state: "sad", atStep: 0 },
    { state: "happy", atStep: 2 },
  ],
};

describe("ScriptPackageSchema", () => {
  it("parses a valid ScriptPackage", () => {
    const result = ScriptPackageSchema.safeParse(VALID_PACKAGE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.templateId).toBe("fix-this-error");
      expect(result.data.bodySteps).toHaveLength(2);
    }
  });

  it("fails when bodyStep has code but no language", () => {
    const invalid = {
      ...VALID_PACKAGE,
      bodySteps: [{ text: "some step", code: "console.log('hi')" }],
    };
    const result = ScriptPackageSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.errors.map((e) => e.path.join("."));
      expect(paths.some((p) => p.includes("language"))).toBe(true);
    }
  });

  it("fails for an invalid templateId", () => {
    const invalid = { ...VALID_PACKAGE, templateId: "not-a-real-template" };
    const result = ScriptPackageSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
