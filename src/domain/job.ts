import type { ScriptPackage } from "./script-package.js";

export type JobId = string;

export type JobState =
  | "draft"
  | "generating"
  | "verifying"
  | "rendering"
  | "review"
  | "approved"
  | "posted"
  | "revising"
  | "rejected"
  | "failed";

export interface Job {
  id: JobId;
  question: string;
  state: JobState;
  scriptPackage?: ScriptPackage;
  mediaPath?: string;
  telegramRef?: { chatId: number; messageId: number };
  publishResults?: Array<{
    platform: "instagram" | "facebook" | "tiktok";
    ok: boolean;
    error?: string;
  }>;
  scheduledFor?: string;
  /** Last operator revise instruction, applied on the next regeneration. */
  lastRevision?: string;
  createdAt: string;
  updatedAt: string;
}
