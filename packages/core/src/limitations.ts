/**
 * What the assistant can and cannot do through Liara's real APIs (spec:
 * "where something is not available via API, say so clearly"). One list feeds
 * the agent tool `explain_limitations`, the console's /limits page and the docs.
 * Sources: docs/liara-api/NOTES.md (spec, CLI help, CLI source).
 */

export type CapabilityStatus = "api" | "partial" | "none";

export interface Capability {
  area: "deploy" | "config" | "monitoring" | "troubleshooting" | "domain" | "data" | "account";
  titleFa: string;
  status: CapabilityStatus;
  /** How it is done, or what the user must do instead. */
  howFa: string;
  endpoint?: string;
}

export const CAPABILITIES: Capability[] = [
  { area: "deploy", titleFa: "ساخت اپ و انتخاب پلن", status: "api", howFa: "خودکار، بعد از تأیید نقشه", endpoint: "POST /v1/projects" },
  { area: "deploy", titleFa: "آپلود کد و دیپلوی", status: "api", howFa: "خودکار، بعد از تأیید", endpoint: "POST /v2/projects/{name}/sources → /releases" },
  { area: "deploy", titleFa: "لاگ زنده‌ی بیلد", status: "api", howFa: "از endpoint که CLI رسمی لیارا استفاده می‌کند (در OpenAPI نیست)", endpoint: "GET /v2/releases/{id}/build-logs" },
  { area: "deploy", titleFa: "برگرداندن به ریلیز قبلی (rollback)", status: "none", howFa: "API ندارد؛ از بخش «ریلیزها» در کنسول لیارا، یا دیپلوی دوباره‌ی نسخه‌ی سالم" },
  { area: "config", titleFa: "تنظیم متغیرهای محیطی", status: "api", howFa: "با تأیید؛ مقدار رمزها هرگز به مدل زبانی نمی‌رسد", endpoint: "POST /v1/projects/update-envs" },
  { area: "config", titleFa: "خواندن مقدار متغیرهای محیطی", status: "partial", howFa: "عمداً فقط نام‌ها خوانده می‌شود؛ مقدارها برای امنیت دور ریخته می‌شوند" },
  { area: "config", titleFa: "ری‌استارت، روشن/خاموش", status: "api", howFa: "ری‌استارت با تأیید؛ خاموش‌کردن عملیات حساس با تأیید دوم", endpoint: "POST /v1/projects/{name}/actions/*" },
  { area: "config", titleFa: "تغییر پلن (منابع)", status: "api", howFa: "با تأیید و نمایش تغییر هزینه", endpoint: "POST /v1/projects/{name}/resize" },
  { area: "config", titleFa: "قیمت دقیق پلن‌ها", status: "partial", howFa: "کاتالوگ پلن از /v1/me خوانده می‌شود ولی ساختارش در مستند API نیامده؛ اگر نشد، قیمت تخمینی با برچسب «تخمینی» نشان داده می‌شود", endpoint: "GET /v1/me" },
  { area: "monitoring", titleFa: "مصرف CPU و RAM", status: "api", howFa: "خلاصه‌ی لحظه‌ای", endpoint: "GET /v1/projects/{name}/metrics/summary" },
  { area: "monitoring", titleFa: "زمان پاسخ (latency)", status: "partial", howFa: "API متریکش را ندارد؛ از لاگ درخواست‌ها و چند درخواست آزمایشی به آدرس اپ اندازه گرفته می‌شود" },
  { area: "monitoring", titleFa: "لاگ برنامه", status: "api", howFa: "خوانده و تحلیل می‌شود (نرخ خطا، خوشه‌بندی خطاها)", endpoint: "GET /v1/projects/{name}/logs" },
  { area: "monitoring", titleFa: "پایش ۲۴ساعته و هشدار", status: "partial", howFa: "بررسی دوره‌ای سلامت داخل خود راه‌انداز (نه سرویس لیارا)؛ هشدار در ربات بله" },
  { area: "troubleshooting", titleFa: "وضعیت داخلی دیتابیس‌های بیرون از لیارا", status: "none", howFa: "قابل دیدن نیست؛ فقط اثرش در لاگ اپ (مثلاً ECONNREFUSED) تشخیص داده می‌شود" },
  { area: "troubleshooting", titleFa: "اصلاح کد برنامه", status: "partial", howFa: "برای خطاهای شناخته‌شده diff پیشنهاد و بعد از تأیید روی نسخه‌ی کاری اعمال و دوباره دیپلوی می‌شود؛ مخزن اصلی شما دست نمی‌خورد" },
  { area: "domain", titleFa: "اتصال دامنه به اپ و صدور SSL", status: "api", howFa: "با تأیید", endpoint: "POST /v1/domains, /v1/domains/provision-ssl-certs" },
  { area: "domain", titleFa: "ساخت DNS و رکوردها روی DNS لیارا", status: "api", howFa: "با تأیید", endpoint: "dns-service: POST /api/v1/zones, /dns-records" },
  { area: "domain", titleFa: "تغییر سرورهای نام (NS) در ایرنیک", status: "none", howFa: "ایرنیک API عمومی ندارد؛ مقادیر دقیق را می‌دهم و شما در nic.ir وارد می‌کنید" },
  { area: "deploy", titleFa: "استقرار خودکار با هر push (CI/CD)", status: "partial", howFa: "فایل GitHub Actions را می‌سازم؛ گذاشتن آن در مخزن و تعریف Secret در گیت‌هاب با شماست (به مخزن شما دسترسی نوشتن نداریم)" },
  { area: "data", titleFa: "فهرست دیتابیس‌ها و دیسک‌ها", status: "api", howFa: "فقط‌خواندنی", endpoint: "GET /v1/databases, /v1/projects/{id}/disks" },
  { area: "account", titleFa: "شارژ حساب و پرداخت", status: "none", howFa: "فقط از کنسول لیارا" },
];

export function capabilitiesFor(topic?: string): Capability[] {
  if (!topic) return CAPABILITIES;
  const t = topic.toLowerCase();
  const hits = CAPABILITIES.filter((c) => c.area === t || c.titleFa.includes(topic) || c.howFa.includes(topic));
  return hits.length ? hits : CAPABILITIES;
}
