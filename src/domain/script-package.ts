import { z } from "zod";

export const TemplateIdSchema = z.enum([
  "60-second-concept",
  "fix-this-error",
  "x-in-3-steps",
  "dont-do-this",
  "tool-of-the-week",
]);

export type TemplateId = z.infer<typeof TemplateIdSchema>;

export const MascotStateSchema = z.enum([
  "idle",
  "talking",
  "intro",
  "outro",
  "happy",
  "excited",
  "sad",
  "shy",
  "cry",
  "sleep",
  "damage",
]);

export type MascotState = z.infer<typeof MascotStateSchema>;

const BodyStepSchema = z
  .object({
    text: z.string(),
    code: z.string().optional(),
    language: z.enum(["javascript", "typescript", "python"]).optional(),
  })
  .refine((step) => step.code === undefined || step.language !== undefined, {
    message: "language is required when code is present",
    path: ["language"],
  });

export const ScriptPackageSchema = z.object({
  templateId: TemplateIdSchema,
  hook: z.string(),
  bodySteps: z.array(BodyStepSchema),
  voiceoverText: z.string(),
  captionsText: z.string(),
  socialCaption: z.string(),
  hashtags: z.array(z.string()),
  coverSpec: z.object({
    title: z.string(),
    subtitle: z.string().optional(),
  }),
  mascotCues: z.array(
    z.object({
      state: MascotStateSchema,
      atStep: z.number().int(),
    }),
  ),
});

export type ScriptPackage = z.infer<typeof ScriptPackageSchema>;
