/**
 * Hero moment 2: "deploy from a chat message". A Bale / Telegram bot (same
 * Bot API shape; Bale: https://tapi.bale.ai, Telegram: https://api.telegram.org)
 * that starts runs from a GitHub link and turns approvals into chat buttons.
 *
 * Runs inside the console's process, so a run started from a phone shows up
 * live on the console timeline. Safety:
 *  - only chat ids in CHAT_ALLOWED_IDS may talk to it (empty list = nobody);
 *  - button presses are approvals from that chat (audited as user:chat:<id>);
 *  - destructive approvals need the resource name typed as a reply;
 *  - secret values are never asked for in chat (chat history lives on a third
 *    party server); those approvals must be completed in the console.
 */
import type { AgentRuntime } from "../agent/runtime";
import type { AgentEvent, ApprovalRequest } from "../agent/types";
import { toman } from "../format/fa";
import { findRepoRef } from "../repo/workspace";

interface Update {
  update_id: number;
  message?: { message_id: number; chat: { id: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number } } };
}

export interface ChatBotOptions {
  token: string;
  apiBase: string;
  allowedChatIds: string[];
  consoleUrl?: string;
}

export class ChatBot {
  private offset = 0;
  private running = false;
  /** chat id → run it is following */
  private follows = new Map<number, string>();
  /** chat id → approval waiting for a typed resource name */
  private awaitingConfirm = new Map<number, { runId: string; approvalId: string; resource: string }>();
  private unsub: (() => void) | null = null;

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly opts: ChatBotOptions,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.unsub = this.runtime.subscribeAll((e) => void this.onEvent(e));
    void this.loop();
  }

  stop(): void {
    this.running = false;
    this.unsub?.();
  }

  private async api<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
    try {
      const res = await fetch(`${this.opts.apiBase}/bot${this.opts.token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(method === "getUpdates" ? 40_000 : 15_000),
      });
      const data = (await res.json()) as { ok: boolean; result?: T };
      return data.ok ? (data.result ?? null) : null;
    } catch {
      return null;
    }
  }

  private send(chatId: number, text: string, buttons?: Array<Array<{ text: string; callback_data: string }>>) {
    return this.api("sendMessage", { chat_id: chatId, text: text.slice(0, 3900), ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) });
  }

  private async loop() {
    while (this.running) {
      const updates = await this.api<Update[]>("getUpdates", { offset: this.offset, timeout: 30 });
      if (!updates) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      for (const u of updates) {
        this.offset = u.update_id + 1;
        try {
          await this.handle(u);
        } catch (err) {
          console.warn(`[chat-bot] ${(err as Error).message}`);
        }
      }
    }
  }

  private allowed(chatId: number): boolean {
    return this.opts.allowedChatIds.includes(String(chatId));
  }

  private async handle(u: Update) {
    if (u.callback_query) {
      const chatId = u.callback_query.message?.chat.id;
      await this.api("answerCallbackQuery", { callback_query_id: u.callback_query.id });
      if (!chatId || !this.allowed(chatId)) return;
      const [tag, runId, approvalId, decision] = (u.callback_query.data ?? "").split(":");
      if (tag !== "a" || !runId || !approvalId) return;
      const approval = this.runtime.getRun(runId)?.approvals.find((a) => a.id === approvalId);
      if (!approval) return;
      if (decision === "y" && approval.requireTypedConfirmation) {
        this.awaitingConfirm.set(chatId, { runId, approvalId, resource: approval.requireTypedConfirmation });
        await this.send(chatId, `عملیات حساس است. برای تأیید، نام «${approval.requireTypedConfirmation}» را دقیقاً بفرستید.`);
        return;
      }
      const res = await this.runtime.resolveApproval(runId, approvalId, {
        decision: decision === "y" || decision === "b" ? "approved" : "denied",
        actor: `user:chat:${chatId}`,
        budgetOverride: decision === "b",
      });
      if (!res.ok) await this.send(chatId, res.errorFa ?? "انجام نشد.");
      return;
    }

    const msg = u.message;
    if (!msg?.text) return;
    const chatId = msg.chat.id;
    if (!this.allowed(chatId)) {
      await this.send(chatId, `این ربات خصوصی است. شناسه‌ی این گفتگو: ${chatId} (برای فعال‌سازی، آن را به CHAT_ALLOWED_IDS اضافه کنید).`);
      return;
    }
    const pending = this.awaitingConfirm.get(chatId);
    if (pending) {
      this.awaitingConfirm.delete(chatId);
      const res = await this.runtime.resolveApproval(pending.runId, pending.approvalId, { decision: "approved", actor: `user:chat:${chatId}`, confirmText: msg.text.trim() });
      if (!res.ok) await this.send(chatId, res.errorFa ?? "تأیید نشد.");
      return;
    }
    if (msg.text.startsWith("/start")) {
      await this.send(chatId, "سلام، راهی هستم. لینک مخزن GitHub را بفرستید تا تحلیل و بعد از تأیید شما روی لیارا مستقر کنم؛ یا بپرسید «چرا demo-shop از کار افتاده؟».");
      return;
    }
    const run = this.runtime.startRun({ message: msg.text.slice(0, 2000), trigger: "chat", actor: `user:chat:${chatId}` });
    this.follows.set(chatId, run.id);
    await this.send(chatId, findRepoRef(msg.text) ? "مخزن را گرفتم؛ تحلیل می‌کنم…" : "بررسی می‌کنم…");
  }

  private chatFor(runId: string): number | null {
    for (const [chat, id] of this.follows) if (id === runId) return chat;
    return null;
  }

  private async onEvent(e: AgentEvent) {
    // ChatOps alert: incident runs started by the health monitor go to the first allowed chat.
    if (e.type === "run_started" && e.trigger === "incident" && this.chatFor(e.runId) === null) {
      const first = Number(this.opts.allowedChatIds[0]);
      if (Number.isFinite(first) && first !== 0) {
        this.follows.set(first, e.runId);
        await this.send(first, `🚨 ${e.messageFa}`);
      }
      return;
    }
    const chatId = this.chatFor(e.runId);
    if (chatId === null) return;
    switch (e.type) {
      case "assistant":
        await this.send(chatId, e.text);
        break;
      case "release":
        if (e.state === "READY" || e.state === "FAILED" || e.state === "UNHEALTHY") await this.send(chatId, `ریلیز ${e.releaseId}: ${e.state}`);
        break;
      case "approval_required":
        await this.sendApproval(chatId, e.approval);
        break;
      case "summary": {
        const s = e.card;
        await this.send(chatId, [`نتیجه: ${s.outcome === "healthy" ? "✅ سالم" : s.outcome}`, s.url && s.outcome === "healthy" ? s.url : "", s.rootCauseFa ? `ریشه‌ی مشکل: ${s.rootCauseFa}` : "", ...s.fixesFa.map((f) => `اصلاح: ${f}`)].filter(Boolean).join("\n"));
        this.follows.delete(chatId);
        break;
      }
      default:
        break;
    }
  }

  private async sendApproval(chatId: number, a: ApprovalRequest) {
    const lines = [`🟠 درخواست تأیید: ${a.titleFa}`];
    if (a.plan) {
      lines.push(`اپ: ${a.plan.appName} · پلتفرم: ${a.plan.platform} · پورت: ${a.plan.port}`, `پلن: ${a.plan.plan.labelFa} · ${toman(a.plan.monthlyCostToman)}/ماه${a.plan.pricesVerified ? "" : " (تخمینی)"}`);
      for (const act of a.plan.actions) lines.push(`• ${act.titleFa}`);
      for (const w of a.plan.warnings) lines.push(`⚠ ${w.messageFa}`);
    }
    for (const d of a.diffs ?? []) lines.push(d.diff.split("\n").slice(2).join("\n"));
    if (a.dryRun) lines.push("(DRY_RUN: چیزی اجرا نمی‌شود)");
    if (a.secretInputs.length) {
      lines.push(`این مرحله به مقدار محرمانه (${a.secretInputs.map((s) => s.key).join("، ")}) نیاز دارد که نباید در چت فرستاده شود. لطفاً در کنسول تأیید کنید${this.opts.consoleUrl ? `: ${this.opts.consoleUrl}` : "."}`);
      await this.send(chatId, lines.join("\n"), [[{ text: "❌ رد", callback_data: `a:${a.runId}:${a.id}:n` }]]);
      return;
    }
    const approve = a.requireBudgetOverride ? { text: "✅ تأیید با عبور از سقف بودجه", callback_data: `a:${a.runId}:${a.id}:b` } : { text: "✅ تأیید", callback_data: `a:${a.runId}:${a.id}:y` };
    await this.send(chatId, lines.join("\n"), [[approve, { text: "❌ رد", callback_data: `a:${a.runId}:${a.id}:n` }]]);
  }
}
