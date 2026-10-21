/** Hero moment 2: deploy from a chat message, against a fake Bale/Telegram Bot API. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatBot } from "../src/chat/chat-bot";
import { makeApp } from "./helpers";

const API = "https://bot.example.test";

function fakeBotApi() {
  const queue: unknown[] = [];
  const sent: Array<{ text: string; buttons: Array<{ text: string; callback_data: string }> }> = [];
  let id = 1;
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith(API)) return realFetch(url, init);
    const method = u.split("/").pop();
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (method === "getUpdates") {
      await new Promise((r) => setTimeout(r, 15));
      const result = queue.splice(0);
      return Response.json({ ok: true, result });
    }
    if (method === "sendMessage") sent.push({ text: body.text, buttons: body.reply_markup?.inline_keyboard?.flat() ?? [] });
    return Response.json({ ok: true, result: true });
  });
  return {
    sent,
    message: (chatId: number, text: string) => queue.push({ update_id: id++, message: { message_id: id, chat: { id: chatId }, text } }),
    press: (chatId: number, data: string) => queue.push({ update_id: id++, callback_query: { id: String(id), data, message: { message_id: 1, chat: { id: chatId } } } }),
  };
}

const until = async (cond: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};

afterEach(() => vi.unstubAllGlobals());

describe("chat bot", () => {
  it("deploys from a GitHub link with approvals as buttons and returns the live URL", async () => {
    const api = fakeBotApi();
    const app = makeApp();
    const bot = new ChatBot(app.runtime, { token: "T", apiBase: API, allowedChatIds: ["42"] });
    bot.start();
    try {
      api.message(42, "https://github.com/acme/node-no-start");
      // 1st approval: the plan. 2nd: the fix (+ its redeploy).
      for (let n = 1; n <= 2; n++) {
        await until(() => api.sent.filter((s) => s.buttons.some((b) => b.text.startsWith("✅"))).length >= n);
        const card = api.sent.filter((s) => s.buttons.length).at(-1)!;
        api.press(42, card.buttons.find((b) => b.text.startsWith("✅"))!.callback_data);
      }
      await until(() => api.sent.some((s) => s.text.includes("https://node-no-start.liara.run") && s.text.includes("سالم")));
      const run = app.runtime.listRuns()[0]!;
      expect(run.trigger).toBe("chat");
      expect(run.summary?.outcome).toBe("healthy");
      expect(app.audit.list({ runId: run.id }).some((a) => a.actor === "user:chat:42" && a.result === "approved")).toBe(true);
    } finally {
      bot.stop();
    }
  });

  it("ignores chats that are not allowed and never starts a run for them", async () => {
    const api = fakeBotApi();
    const app = makeApp();
    const bot = new ChatBot(app.runtime, { token: "T", apiBase: API, allowedChatIds: ["42"] });
    bot.start();
    try {
      api.message(7, "https://github.com/acme/node-no-start");
      await until(() => api.sent.length > 0);
      expect(api.sent[0]!.text).toContain("خصوصی");
      expect(app.runtime.listRuns()).toEqual([]);
      // A forged button press from a stranger cannot approve anything either.
      api.press(7, "a:run_x:apr_x:y");
      await new Promise((r) => setTimeout(r, 100));
      expect(app.audit.list().some((a) => a.result === "approved")).toBe(false);
    } finally {
      bot.stop();
    }
  });
});
