/**
 * Connecting a domain (spec: "guide domain setup, incl. the registrar panel such
 * as IRNIC; the user only does what is out of the assistant's reach").
 *
 * The assistant does everything Liara's APIs allow (attach the domain, create
 * the zone and records on Liara DNS, issue SSL) and turns the rest (changing
 * nameservers at IRNIC, which has no API for us) into an exact checklist with
 * the values to paste.
 */
import { LiaraRequests, type DnsRecord, type DnsZone, type DomainInfo } from "@rahandaz/liara";
import { z } from "zod";
import { defineTool, type ToolContext } from "./types";

const appName = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/);
export const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,20}$/;
const domainName = z.string().toLowerCase().regex(DOMAIN_RE, "invalid domain name");

export interface DomainStep {
  key: "attach" | "records" | "nameservers" | "verified" | "ssl";
  titleFa: string;
  who: "agent" | "user";
  done: boolean;
  detailFa: string;
  /** Values the user must copy (nameservers, record values). */
  values?: Array<{ labelFa: string; text: string }>;
}

export interface DomainStatus {
  app: string;
  domain: string;
  steps: DomainStep[];
  next: { who: "agent" | "user" | "none"; tool?: "add_domain" | "setup_dns" | "enable_ssl"; textFa: string };
  limitationsFa: string[];
}

const isActive = (s?: string) => /active|ok|verified|connected|success/i.test(s ?? "");
const sslIssued = (s?: string) => /issued|active|valid|enabled|ok/i.test(s ?? "");

function wantedRecords(d: DomainInfo): DnsRecord[] {
  const out: DnsRecord[] = [];
  if (d.cnameTarget) out.push({ name: "@", type: "ALIAS", ttl: 3600, contents: [{ host: d.cnameTarget }] });
  if (d.verificationCode) out.push({ name: "@", type: "TXT", ttl: 3600, contents: [{ text: d.verificationCode }] });
  return out;
}

function hasRecord(records: DnsRecord[], want: DnsRecord): boolean {
  return records.some(
    (r) => r.name === want.name && (r.type === want.type || (want.type === "ALIAS" && r.type === "CNAME")) && JSON.stringify(r.contents) === JSON.stringify(want.contents),
  );
}

export async function domainStatus(ctx: ToolContext, app: string, domain: string): Promise<DomainStatus> {
  const attached = (await ctx.liara.listDomains(app)).find((d) => d.name === domain) ?? null;
  const details = attached ? await ctx.liara.checkDomain(attached.id).catch(() => attached) : null;
  const zone: DnsZone | null = await ctx.liara.getDnsZone(domain).catch(() => null);
  const records = zone ? await ctx.liara.listDnsRecords(domain).catch(() => []) : [];
  const want = details ? wantedRecords(details) : [];
  const recordsDone = want.length > 0 && want.every((w) => hasRecord(records, w));
  const nsDone = zone ? isActive(zone.status) : false;
  const verified = isActive(details?.status);
  const ssl = sslIssued(details?.certificatesStatus);

  const steps: DomainStep[] = [
    { key: "attach", titleFa: "اتصال دامنه به اپ در لیارا", who: "agent", done: Boolean(attached), detailFa: attached ? `${domain} به ${app} وصل است` : "هنوز به اپ وصل نشده" },
    {
      key: "records",
      titleFa: "ثبت رکوردهای DNS",
      who: "agent",
      done: recordsDone,
      detailFa: recordsDone ? "رکوردها روی DNS لیارا ثبت شده‌اند" : details ? "رکوردهای لازم هنوز ثبت نشده‌اند" : "بعد از اتصال دامنه معلوم می‌شود",
      values: want.map((w) => ({ labelFa: `${w.type} ${w.name}`, text: Object.values(w.contents[0] ?? {})[0] ?? "" })),
    },
    {
      key: "nameservers",
      titleFa: "تنظیم سرورهای نام (NS) در ایرنیک",
      who: "user",
      done: nsDone,
      detailFa: nsDone
        ? "سرورهای نام دامنه به DNS لیارا اشاره می‌کنند"
        : zone
          ? "این کار فقط از پنل ایرنیک (nic.ir) شدنی است؛ مقادیر زیر را آنجا وارد کنید"
          : "بعد از ساخت DNS دامنه در لیارا، مقادیرش اینجا می‌آید",
      values: zone && !nsDone ? zone.nameServers.map((ns, i) => ({ labelFa: `NS ${i + 1}`, text: ns })) : undefined,
    },
    { key: "verified", titleFa: "تأیید دامنه توسط لیارا", who: "agent", done: verified, detailFa: verified ? "لیارا دامنه را تأیید کرد" : "بعد از اعمال NS و رکوردها خودکار تأیید می‌شود" },
    { key: "ssl", titleFa: "فعال‌سازی SSL (https)", who: "agent", done: ssl, detailFa: ssl ? `https://${domain} فعال است` : "بعد از تأیید دامنه، گواهی رایگان صادر می‌کنم" },
  ];

  let next: DomainStatus["next"];
  if (!attached) next = { who: "agent", tool: "add_domain", textFa: `دامنه‌ی ${domain} را به اپ ${app} وصل کنم.` };
  else if (!recordsDone) next = { who: "agent", tool: "setup_dns", textFa: "DNS دامنه را روی لیارا بسازم و رکوردهای لازم را ثبت کنم." };
  else if (!nsDone)
    next = {
      who: "user",
      textFa: `فقط یک کار مانده که از دست من خارج است: در پنل ایرنیک (https://nic.ir) سرورهای نام دامنه‌ی ${domain} را روی ${zone?.nameServers.join(" و ")} بگذارید. بعد بنویسید «انجام دادم» تا بررسی کنم (اعمال تغییر ممکن است از چند دقیقه تا چند ساعت طول بکشد).`,
    };
  else if (!ssl) next = { who: "agent", tool: "enable_ssl", textFa: "گواهی SSL رایگان را صادر کنم تا سایت با https باز شود." };
  else next = { who: "none", textFa: `دامنه آماده است: https://${domain}` };

  return {
    app,
    domain,
    steps,
    next,
    limitationsFa: [
      "ایرنیک API عمومی ندارد؛ تغییر سرورهای نام (NS) را فقط خودتان در nic.ir می‌توانید انجام دهید.",
      "رکورد سوم (CNAME برای تمدید SSL به روش DNS-01) در API لیارا برنمی‌گردد؛ اگر کنسول لیارا آن را خواست، از همان‌جا اضافه کنید.",
    ],
  };
}

export const domainStatusTool = defineTool({
  name: "domain_status",
  description:
    "Check how far connecting a domain to an app has got (read-only): attached to the app?, DNS records on Liara DNS?, nameservers set at the registrar (IRNIC)?, verified?, SSL issued? Returns a checklist (who does each step: agent or user, with exact values to paste) and the next step.",
  kind: "read",
  schema: z.object({ app: appName, domain: domainName }),
  titleFa: (a) => `وضعیت دامنه‌ی ${a.domain}`,
  async execute(a, ctx) {
    const status = await domainStatus(ctx, a.app, a.domain);
    ctx.emit({ type: "domain_status", status });
    const done = status.steps.filter((s) => s.done).length;
    return { ok: true, summaryFa: `${done} از ${status.steps.length} قدم انجام شده · ${status.next.textFa}`, data: status };
  },
});

export const addDomainTool = defineTool({
  name: "add_domain",
  description: "Attach a NEW domain to an app on Liara (POST /v1/domains). Changing or removing an existing domain is not offered.",
  kind: "mutating",
  schema: z.object({ app: appName, domain: domainName }),
  titleFa: (a) => `اتصال دامنه‌ی ${a.domain} به اپ ${a.app}`,
  resource: (a) => a.app,
  plannedCalls: (a) => [LiaraRequests.addDomain(a.app, a.domain)],
  undoFa: (a) => `حذف دامنه‌ی ${a.domain} از بخش دامنه‌های اپ در کنسول لیارا`,
  async execute(a, ctx) {
    const { id } = await ctx.liara.addDomain(a.app, a.domain);
    return { ok: true, summaryFa: `دامنه‌ی ${a.domain} به ${a.app} وصل شد`, data: { domainId: id } };
  },
});

export const setupDnsTool = defineTool({
  name: "setup_dns",
  description: "Create the domain's zone on Liara DNS (if missing) and add the records Liara asks for (ALIAS @ → app, TXT ownership). Needs the domain attached first.",
  kind: "mutating",
  schema: z.object({ app: appName, domain: domainName }),
  titleFa: (a) => `ساخت DNS و ثبت رکوردهای ${a.domain}`,
  resource: (a) => a.app,
  undoFa: (a) => `حذف رکوردها (یا کل DNS) دامنه‌ی ${a.domain} از بخش DNS کنسول لیارا`,
  plannedCalls: (a) => [LiaraRequests.createDnsZone(a.domain), { method: "POST", path: `/api/v1/zones/${a.domain}/dns-records`, note: "ALIAS @ + TXT @ (values from GET /v1/domains/{id}/check)" }],
  async approvalExtras(a, ctx) {
    const attached = (await ctx.liara.listDomains(a.app)).find((d) => d.name === a.domain);
    if (!attached) return {};
    const want = wantedRecords(await ctx.liara.checkDomain(attached.id));
    const zone = await ctx.liara.getDnsZone(a.domain).catch(() => null);
    return {
      calls: [...(zone ? [] : [LiaraRequests.createDnsZone(a.domain)]), ...want.map((w) => LiaraRequests.createDnsRecord(a.domain, w))],
    };
  },
  async execute(a, ctx) {
    const attached = (await ctx.liara.listDomains(a.app)).find((d) => d.name === a.domain);
    if (!attached) return { ok: false, summaryFa: "اول باید دامنه به اپ وصل شود", error: "domain not attached; call add_domain first" };
    const details = await ctx.liara.checkDomain(attached.id);
    let zone = await ctx.liara.getDnsZone(a.domain);
    if (!zone) zone = await ctx.liara.createDnsZone(a.domain);
    const existing = await ctx.liara.listDnsRecords(a.domain).catch(() => []);
    const added: string[] = [];
    for (const w of wantedRecords(details)) {
      if (hasRecord(existing, w)) continue;
      await ctx.liara.createDnsRecord(a.domain, w);
      added.push(`${w.type} ${w.name}`);
    }
    return { ok: true, summaryFa: `DNS آماده شد${added.length ? ` (${added.join("، ")})` : ""}`, data: { zoneStatus: zone.status, nameServers: zone.nameServers, added } };
  },
});

export const enableSslTool = defineTool({
  name: "enable_ssl",
  description: "Issue a free SSL certificate for a verified domain (POST /v1/domains/provision-ssl-certs).",
  kind: "mutating",
  schema: z.object({ app: appName, domain: domainName }),
  titleFa: (a) => `فعال‌سازی SSL برای ${a.domain}`,
  resource: (a) => a.app,
  plannedCalls: (a) => [LiaraRequests.enableSsl(a.domain)],
  undoFa: () => "نیازی به برگرداندن ندارد",
  async execute(a, ctx) {
    await ctx.liara.enableSsl(a.domain);
    return { ok: true, summaryFa: `SSL برای ${a.domain} صادر شد`, data: { url: `https://${a.domain}` } };
  },
});
