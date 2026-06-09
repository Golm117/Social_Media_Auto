import { Bot, InlineKeyboard, InputFile } from "grammy";
import type { Job } from "../../domain/job.js";

export type OperatorAction = "approve" | "postNow" | "revise" | "reject";

export type QuestionHandler = (question: string) => Promise<void> | void;
export type ActionHandler = (
  action: OperatorAction,
  jobId: string,
  payload?: string,
) => Promise<void> | void;

export interface ConversationGateway {
  onQuestion(handler: QuestionHandler): void;
  onAction(handler: ActionHandler): void;
  notify(job: Job, message: string): Promise<void>;
  sendDraftForApproval(job: Job): Promise<void>;
}

export interface TelegramGatewayConfig {
  token: string;
  operatorChatId: number;
}

export class TelegramGateway implements ConversationGateway {
  private readonly bot: Bot;
  private readonly operatorChatId: number;
  private questionHandler: QuestionHandler = () => {};
  private actionHandler: ActionHandler = () => {};
  private pendingReviseJobId: string | null = null;

  constructor({ token, operatorChatId }: TelegramGatewayConfig) {
    this.bot = new Bot(token);
    this.operatorChatId = operatorChatId;
    this.wire();
  }

  onQuestion(handler: QuestionHandler): void {
    this.questionHandler = handler;
  }
  onAction(handler: ActionHandler): void {
    this.actionHandler = handler;
  }

  async notify(_job: Job, message: string): Promise<void> {
    await this.bot.api.sendMessage(this.operatorChatId, message);
  }

  async sendDraftForApproval(job: Job): Promise<void> {
    if (!job.mediaPath) return;
    const caption = job.scriptPackage?.socialCaption ?? "Draft ready";
    const kb = new InlineKeyboard()
      .text("✅ Approve", `approve:${job.id}`)
      .text("⚡ Post now", `postNow:${job.id}`)
      .row()
      .text("✏️ Revise", `revise:${job.id}`)
      .text("❌ Reject", `reject:${job.id}`);
    await this.bot.api.sendVideo(this.operatorChatId, new InputFile(job.mediaPath), {
      caption,
      reply_markup: kb,
    });
  }

  start(): void {
    // long polling — no public URL needed (webhook is a deployment refinement)
    void this.bot.start();
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  private fromOperator(chatId: number | undefined): boolean {
    return chatId === this.operatorChatId;
  }

  private wire(): void {
    this.bot.on("message:text", async (ctx) => {
      if (!this.fromOperator(ctx.chat?.id)) return;
      const text = ctx.message.text.trim();
      if (text.startsWith("/")) {
        if (text === "/start")
          await ctx.reply(
            "👋 I'm Coddy's assistant. Send me a coding question and I'll make a Reel.",
          );
        return;
      }
      if (this.pendingReviseJobId) {
        const jobId = this.pendingReviseJobId;
        this.pendingReviseJobId = null;
        await this.actionHandler("revise", jobId, text);
        return;
      }
      await this.questionHandler(text);
    });

    this.bot.on("callback_query:data", async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!this.fromOperator(ctx.chat?.id)) return;
      const [action, jobId] = ctx.callbackQuery.data.split(":");
      if (!jobId) return;
      // remove the buttons so a tap can't be fired twice (prevents duplicate publish / illegal transitions)
      await ctx.editMessageReplyMarkup().catch(() => {});
      if (action === "revise") {
        this.pendingReviseJobId = jobId;
        await ctx.reply("✏️ What should I change? Send your instruction.");
        return;
      }
      if (action === "approve" || action === "postNow" || action === "reject") {
        await this.actionHandler(action, jobId);
      }
    });

    // Error boundary — a handler error must never crash the bot process.
    this.bot.catch((err) => {
      console.error("bot handler error:", err.error ?? err);
      this.bot.api
        .sendMessage(
          this.operatorChatId,
          "⚠️ Something went wrong handling that — please try again.",
        )
        .catch(() => {});
    });
  }
}
