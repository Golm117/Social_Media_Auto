import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { MascotStateSchema, ScriptPackageSchema } from "../../domain/script-package.js";
import type { ModelRole } from "./content-generator.js";
import { DefaultContentGenerator } from "./content-generator.js";
import type { ModelClient } from "./content-generator.js";

// ─── MockModelClient ────────────────────────────────────────────────────────

interface CallRecord {
  role: ModelRole;
  prompt: string;
}

class MockModelClient implements ModelClient {
  readonly calls: CallRecord[] = [];

  constructor(
    private readonly responses: {
      glue: unknown;
      code: unknown;
      copy: unknown;
    },
  ) {}

  async generateObject<T>(role: ModelRole, prompt: string, _schema: z.ZodType<T>): Promise<T> {
    this.calls.push({ role, prompt });
    return this.responses[role] as T;
  }

  calledRoles(): ModelRole[] {
    return this.calls.map((c) => c.role);
  }
}

// ─── Canned responses ───────────────────────────────────────────────────────

const GLUE_WITH_CODE = {
  templateId: "60-second-concept",
  steps: [
    { text: "Closures capture their surrounding scope", needsCode: true, language: "javascript" },
    { text: "You can use closures to create private state", needsCode: false },
  ],
};

const GLUE_NO_CODE = {
  templateId: "x-in-3-steps",
  steps: [
    { text: "Step one: define your goal", needsCode: false },
    { text: "Step two: break it down", needsCode: false },
    { text: "Step three: implement", needsCode: false },
  ],
};

const GLUE_FIX_THIS_ERROR = {
  templateId: "fix-this-error",
  steps: [
    { text: "Spot the TypeError", needsCode: true, language: "javascript" },
    { text: "Apply the fix", needsCode: true, language: "javascript" },
  ],
};

const CODE_OUTPUT = {
  snippets: [{ stepIndex: 0, code: "const fn = () => x;", language: "javascript" }],
};

const CODE_OUTPUT_FIX = {
  snippets: [
    { stepIndex: 0, code: "const x = undefined; x.toString();", language: "javascript" },
    { stepIndex: 1, code: "const x = undefined; x?.toString();", language: "javascript" },
  ],
};

const COPY_OUTPUT = {
  hook: "Closures are everywhere in JavaScript",
  voiceoverText:
    "Let me show you how closures work. A closure captures the variables in scope when it was created. This lets you build powerful patterns like private state and factories.",
  captionsText: "Closures capture scope — here's how",
  socialCaption: "Master JavaScript closures in 60 seconds ✨",
  hashtags: ["javascript", "closures", "webdev", "coding", "learntocode"],
  coverSpec: { title: "Closures Explained", subtitle: "60-second concept" },
  mascotCues: [
    { state: "intro", atStep: -1 },
    { state: "talking", atStep: 0 },
    { state: "excited", atStep: 1 },
    { state: "outro", atStep: 1 },
  ],
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("DefaultContentGenerator — happy path", () => {
  it("returns a ScriptPackage-valid object", async () => {
    const client = new MockModelClient({
      glue: GLUE_WITH_CODE,
      code: CODE_OUTPUT,
      copy: COPY_OUTPUT,
    });
    const gen = new DefaultContentGenerator(client);
    const result = await gen.generate("What is a closure?");

    // Parse again to assert Zod validity
    expect(() => ScriptPackageSchema.parse(result)).not.toThrow();
    expect(result.templateId).toBe("60-second-concept");
    expect(result.hook).toBe("Closures are everywhere in JavaScript");
  });
});

describe("DefaultContentGenerator — template propagation", () => {
  it("propagates templateId from glue stage to final result", async () => {
    const client = new MockModelClient({
      glue: GLUE_FIX_THIS_ERROR,
      code: CODE_OUTPUT_FIX,
      copy: COPY_OUTPUT,
    });
    const gen = new DefaultContentGenerator(client);
    const result = await gen.generate("Why does x.toString() fail?");

    expect(result.templateId).toBe("fix-this-error");
  });
});

describe("DefaultContentGenerator — code stage wiring", () => {
  it("bodySteps has code+language set when outline has needsCode steps", async () => {
    const client = new MockModelClient({
      glue: GLUE_WITH_CODE,
      code: CODE_OUTPUT,
      copy: COPY_OUTPUT,
    });
    const gen = new DefaultContentGenerator(client);
    const result = await gen.generate("What is a closure?");

    const codedStep = result.bodySteps.find((s) => s.code !== undefined);
    expect(codedStep).toBeDefined();
    expect(codedStep?.code).toBe("const fn = () => x;");
    expect(codedStep?.language).toBe("javascript");
    expect(client.calledRoles()).toContain("code");
  });
});

describe("DefaultContentGenerator — no-code skip", () => {
  it("does NOT call code role when no step needs code", async () => {
    const client = new MockModelClient({
      glue: GLUE_NO_CODE,
      code: null,
      copy: COPY_OUTPUT,
    });
    const gen = new DefaultContentGenerator(client);
    const result = await gen.generate("What are the 3 steps to learn programming?");

    expect(client.calledRoles()).not.toContain("code");
    expect(() => ScriptPackageSchema.parse(result)).not.toThrow();
  });
});

describe("DefaultContentGenerator — role routing", () => {
  it("calls glue and copy roles for every request", async () => {
    const client = new MockModelClient({
      glue: GLUE_NO_CODE,
      code: null,
      copy: COPY_OUTPUT,
    });
    const gen = new DefaultContentGenerator(client);
    await gen.generate("Any question");

    expect(client.calledRoles()).toContain("glue");
    expect(client.calledRoles()).toContain("copy");
  });

  it("calls all three roles when code is needed", async () => {
    const client = new MockModelClient({
      glue: GLUE_WITH_CODE,
      code: CODE_OUTPUT,
      copy: COPY_OUTPUT,
    });
    const gen = new DefaultContentGenerator(client);
    await gen.generate("What is a closure?");

    const roles = client.calledRoles();
    expect(roles).toContain("glue");
    expect(roles).toContain("code");
    expect(roles).toContain("copy");
  });
});

describe("DefaultContentGenerator — language hint", () => {
  const GLUE_SQL = {
    templateId: "60-second-concept",
    steps: [{ text: "Group rows by department", needsCode: true, language: "sql" }],
  };
  const CODE_SQL = {
    snippets: [
      {
        stepIndex: 0,
        code: "CREATE TABLE u(d TEXT);\nINSERT INTO u VALUES('eng');\nSELECT d FROM u;",
        language: "sql",
      },
    ],
  };

  it("binds the snippet language to the topic hint in both the glue and code prompts", async () => {
    const client = new MockModelClient({ glue: GLUE_SQL, code: CODE_SQL, copy: COPY_OUTPUT });
    const gen = new DefaultContentGenerator(client);
    await gen.generate("How do I GROUP BY?", { language: "sql" });

    const glue = client.calls.find((c) => c.role === "glue")?.prompt ?? "";
    const code = client.calls.find((c) => c.role === "code")?.prompt ?? "";
    expect(glue).toContain("This topic is about sql");
    expect(code).toContain("This topic is about sql");
    // the per-language run rule for sql is surfaced to the code model
    expect(code).toContain("in-memory SQLite");
  });

  it("carries a sql snippet through assembly into the ScriptPackage", async () => {
    const client = new MockModelClient({ glue: GLUE_SQL, code: CODE_SQL, copy: COPY_OUTPUT });
    const gen = new DefaultContentGenerator(client);
    const result = await gen.generate("How do I GROUP BY?", { language: "sql" });
    const coded = result.bodySteps.find((s) => s.code);
    expect(coded?.language).toBe("sql");
  });

  it("omits the binding directive when no language hint is given", async () => {
    const client = new MockModelClient({
      glue: GLUE_WITH_CODE,
      code: CODE_OUTPUT,
      copy: COPY_OUTPUT,
    });
    const gen = new DefaultContentGenerator(client);
    await gen.generate("What is a closure?");
    const glue = client.calls.find((c) => c.role === "glue")?.prompt ?? "";
    expect(glue).not.toContain("This topic is about");
  });
});

describe("DefaultContentGenerator — malformed assembly", () => {
  it("rejects when copy stage omits a required field (socialCaption)", async () => {
    const badCopy = { ...COPY_OUTPUT };
    // @ts-expect-error intentionally removing required field for test
    badCopy.socialCaption = undefined;

    const client = new MockModelClient({
      glue: GLUE_NO_CODE,
      code: null,
      copy: badCopy,
    });
    const gen = new DefaultContentGenerator(client);

    await expect(gen.generate("What is a closure?")).rejects.toThrow();
  });
});

describe("DefaultContentGenerator — mascotCues", () => {
  it("result has at least one mascotCue with a valid MascotState", async () => {
    const client = new MockModelClient({
      glue: GLUE_WITH_CODE,
      code: CODE_OUTPUT,
      copy: COPY_OUTPUT,
    });
    const gen = new DefaultContentGenerator(client);
    const result = await gen.generate("What is a closure?");

    expect(result.mascotCues.length).toBeGreaterThan(0);
    const validStates = MascotStateSchema.options;
    for (const cue of result.mascotCues) {
      expect(validStates).toContain(cue.state);
    }
  });
});
