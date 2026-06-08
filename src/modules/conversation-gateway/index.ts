import type { Job, JobState } from "../../domain/job.js";

// TODO: slice 3
export interface ConversationGateway {
  onQuestion(handler: (question: string, chatId: number) => Promise<void>): void;
  sendDraftForApproval(job: Job): Promise<void>;
  notify(job: Job, status: JobState): Promise<void>;
  onAction(handler: (action: string, chatId: number, messageId: number) => Promise<void>): void;
}
