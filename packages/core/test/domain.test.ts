/** Domain connection: the agent does what Liara's APIs allow; the user only changes nameservers at IRNIC. */
import { describe, expect, it } from "vitest";
import { makeApp, runToEnd } from "./helpers";

describe("connect a domain", () => {
  it("attaches the domain, creates DNS + records, then hands the user exactly one IRNIC step; after 'done' issues SSL", async () => {
    const app = makeApp({ MOCK_LATENCY_SCALE: "1" }); // nameserver propagation takes simulated time
    const tools: string[] = [];
    const run = await runToEnd(app, "دامنه‌ی myshop.ir را به اپ demo-shop وصل کن", { approve: (t) => (tools.push(t), true) });
    expect(tools).toEqual(["add_domain", "setup_dns"]);
    const statuses = app.runtime.events(run.id).flatMap((e) => (e.type === "domain_status" ? [e.status] : []));
    const last = statuses.at(-1)!;
    expect(last.next.who).toBe("user");
    const ns = last.steps.find((s) => s.key === "nameservers")!;
    expect(ns.done).toBe(false);
    expect(ns.values?.length).toBe(2);
    expect(ns.values![0]!.text).toMatch(/^ns1./); // real value, not a redaction placeholder
    expect(run.messages.at(-1)?.content).toContain("nic.ir");
    expect(run.messages.at(-1)?.content).toContain(ns.values![0]!.text);

    // The user changes NS at IRNIC; in mock mode propagation is simulated by time.
    const liara = app.liara as unknown as { zones: Map<string, { createdAt: number }> };
    liara.zones.get("myshop.ir")!.createdAt -= 60_000;
    expect(app.runtime.sendMessage(run.id, "انجام دادم").ok).toBe(true);
    let s = await app.runtime.settled(run.id);
    expect(s.approvals.at(-1)?.tool).toBe("enable_ssl");
    await app.runtime.resolveApproval(run.id, s.pendingApprovalId!, { decision: "approved", actor: "user:test" });
    s = await app.runtime.settled(run.id);
    const final = app.runtime.events(run.id).flatMap((e) => (e.type === "domain_status" ? [e.status] : [])).at(-1)!;
    expect(final.steps.every((st) => st.done)).toBe(true);
    expect(s.messages.at(-1)?.content).toContain("https://myshop.ir");
  });

  it("states the IRNIC limitation instead of pretending to automate it", async () => {
    const app = makeApp({ MOCK_LATENCY_SCALE: "1" });
    const run = await runToEnd(app, "دامنه‌ی blog.example.com را به اپ demo-shop وصل کن");
    const st = app.runtime.events(run.id).flatMap((e) => (e.type === "domain_status" ? [e.status] : [])).at(-1)!;
    expect(st.limitationsFa.join(" ")).toContain("ایرنیک API عمومی ندارد");
  });
});

describe("domain tools obey the policy layer", () => {
  it("add_domain / setup_dns / enable_ssl never run without an approval", async () => {
    for (const tool of ["add_domain", "setup_dns", "enable_ssl"]) {
      const llm = {
        name: "test",
        i: 0,
        async complete() {
          return this.i++ === 0
            ? { message: { role: "assistant" as const, content: null, tool_calls: [{ id: "c1", type: "function" as const, function: { name: tool, arguments: JSON.stringify({ app: "demo-shop", domain: "evil.ir" }) } }] } }
            : { message: { role: "assistant" as const, content: "done" } };
        },
      };
      const app = makeApp({}, llm);
      const run = app.runtime.startRun({ message: "x" });
      const s = await app.runtime.settled(run.id);
      expect(s.status).toBe("awaiting_approval");
      expect(await app.liara.listDomains("demo-shop")).toEqual([]);
    }
  });
});

describe("automation: CI/CD", () => {
  it("generates Liara's GitHub Actions workflow for the app and names the user's two steps", async () => {
    const app = makeApp();
    const run = await runToEnd(app, "برای demo-shop استقرار خودکار با هر push بساز");
    const ev = app.runtime.events(run.id).find((e) => e.type === "ci_setup");
    expect(ev?.type === "ci_setup" && ev.setup.content).toContain('liara deploy --app="demo-shop"');
    expect(ev?.type === "ci_setup" && ev.setup.content).toContain("secrets.LIARA_API_TOKEN");
    expect(run.applied).toEqual([]);
  });
});
