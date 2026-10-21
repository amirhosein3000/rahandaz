import { CAPABILITIES, type CapabilityStatus } from "@rahandaz/core";
import Link from "next/link";
import { Logo } from "@/components/ui";

const GROUPS: Array<{ status: CapabilityStatus; titleFa: string; tone: string }> = [
  { status: "api", titleFa: "از طریق API لیارا، خودکار (با تأیید شما برای تغییرها)", tone: "border-ok/40 bg-ok-soft text-ok" },
  { status: "partial", titleFa: "محدود: بخشی ممکن است و بقیه را این‌طور جبران می‌کنیم", tone: "border-warn/40 bg-warn-soft text-warn" },
  { status: "none", titleFa: "از طریق API ممکن نیست: این‌ها کار شماست و دقیق راهنمایی‌تان می‌کنم", tone: "border-bad/40 bg-bad-soft text-bad" },
];

const AREA_FA: Record<string, string> = {
  deploy: "استقرار",
  config: "تنظیمات",
  monitoring: "پایش",
  troubleshooting: "عیب‌یابی",
  domain: "دامنه",
  data: "داده",
  account: "حساب",
};

export const metadata = { title: "قابلیت‌ها و محدودیت‌ها · راه‌انداز" };

/** Public, static: what the assistant can and cannot do through Liara's real APIs. */
export default function LimitsPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <Link href="/" className="flex items-center gap-2 text-[14px] font-bold">
        <Logo size={28} /> راه‌انداز
      </Link>
      <div className="space-y-2">
        <h1 className="text-2xl font-extrabold">چه کارهایی از دستیار برمی‌آید؟</h1>
        <p className="text-[14px] leading-7 text-muted">
          راه‌انداز فقط از APIهای واقعی لیارا استفاده می‌کند. هر جا API کاری را پشتیبانی نمی‌کند، صریح می‌گوییم و قدم‌هایی که خودتان باید بردارید را دقیق می‌نویسیم. کارهای فقط‌خواندنی (لاگ، متریک، وضعیت) خودکارند؛ هر تغییری تأیید شما را می‌خواهد؛ کارهای حساس تأیید دوم.
        </p>
      </div>
      {GROUPS.map((g) => (
        <section key={g.status} className="space-y-2">
          <h2 className={`inline-block rounded-full border px-3 py-1 text-[13px] font-bold ${g.tone}`}>{g.titleFa}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {CAPABILITIES.filter((c) => c.status === g.status).map((c) => (
              <li key={c.titleFa} className="grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                <div>
                  <div className="text-[14px] font-semibold">{c.titleFa}</div>
                  <div className="text-[11.5px] text-muted">{AREA_FA[c.area]}</div>
                </div>
                <div className="text-[13px] leading-6">
                  {c.howFa}
                  {c.endpoint && (
                    <code className="mt-0.5 block font-mono text-[11.5px] text-muted" dir="ltr">
                      {c.endpoint}
                    </code>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
