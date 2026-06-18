import { readFileSync } from "node:fs";
import { DefaultCodeVerifier, E2BSandbox } from "../src/modules/code-verifier/code-verifier.js";
import {
  DEFAULT_ROUTING,
  DefaultContentGenerator,
  OpenRouterModelClient,
} from "../src/modules/content-generator/content-generator.js";

function envVal(key: string): string {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    if (line.trimStart().startsWith("#") || !line.includes("=")) continue;
    const [k, ...rest] = line.split("=");
    if (k.trim() === key)
      return rest
        .join("=")
        .split(/\s+#/)[0]
        .trim()
        .replace(/^['"]|['"]$/g, "");
  }
  throw new Error(`missing ${key}`);
}

console.log("=== ContentGenerator (OpenRouter) ===");
try {
  const gen = new DefaultContentGenerator(
    new OpenRouterModelClient({ apiKey: envVal("OPENROUTER_API_KEY"), routing: DEFAULT_ROUTING }),
  );
  const sp = await gen.generate("What are 3 ways to write a loop in JavaScript?");
  console.log(
    "  ✅ template:",
    sp.templateId,
    "| steps:",
    sp.bodySteps.length,
    "| hook:",
    JSON.stringify(sp.hook.slice(0, 60)),
  );
  console.log(
    "     code steps:",
    sp.bodySteps.filter((s) => s.code).length,
    "| mascotCues:",
    sp.mascotCues.length,
  );
} catch (e) {
  console.log("  ❌ ContentGenerator FAILED:", String(e).slice(0, 300));
}

console.log("=== CodeVerifier (E2B) ===");
try {
  const cv = new DefaultCodeVerifier(new E2BSandbox({ apiKey: envVal("E2B_API_KEY") }));
  const res = await cv.verify([
    { code: "console.log('ok')", language: "javascript" },
    { code: "this is not valid js!!!", language: "javascript" },
  ]);
  console.log(
    "  results:",
    res.map((r) => ({
      i: r.snippetIndex,
      ok: r.ok,
      out: r.stdout.trim().slice(0, 20),
      err: r.stderr.trim().slice(0, 40),
    })),
  );
} catch (e) {
  console.log("  ❌ CodeVerifier FAILED:", String(e).slice(0, 300));
}
