import type { ScriptPackage } from "../../domain/script-package.js";

// TODO: slice 4
export interface ContentGenerator {
  generate(question: string): Promise<ScriptPackage>;
}
