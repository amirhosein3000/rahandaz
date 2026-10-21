/**
 * Automating the repetitive part: "every push to main deploys to Liara".
 * Generates the GitHub Actions workflow from Liara's own CI/CD docs
 * (docs.liara.ir/paas/cicd/github). Read-only: we have no write access to the
 * user's GitHub repo, so committing the file and adding the secret are the
 * user's two steps, stated as such.
 */
import { z } from "zod";
import { defineTool } from "./types";

export interface CiSetup {
  app: string;
  path: string;
  content: string;
  stepsFa: string[];
  docsUrl: string;
}

export function ciWorkflow(app: string, opts: { port?: number; branch?: string; teamId?: string } = {}): string {
  const flags = [`--app="${app}"`, `--api-token="$LIARA_TOKEN"`, ...(opts.port ? [`--port=${opts.port}`] : []), ...(opts.teamId ? [`--team-id="${opts.teamId}"`] : []), "--no-app-logs"];
  return [
    "name: CD-Liara",
    "on:",
    "  push:",
    "    branches:",
    `      - ${opts.branch ?? "main"}`,
    "jobs:",
    "  deploy:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-node@v4",
    "        with:",
    '          node-version: "22"',
    "      - name: deploy-to-liara",
    "        env:",
    "          LIARA_TOKEN: ${{ secrets.LIARA_API_TOKEN }}",
    "        run: |",
    "          npm i -g @liara/cli@9",
    `          liara deploy ${flags.join(" ")}`,
    "",
  ].join("\n");
}

export const generateCiTool = defineTool({
  name: "generate_ci",
  description:
    "Generate a GitHub Actions workflow that deploys the app to Liara on every push (from Liara's CI/CD docs), plus the two steps only the user can do (add LIARA_API_TOKEN as a repo secret, commit the file). Read-only.",
  kind: "read",
  schema: z.object({ app: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/), branch: z.string().regex(/^[\w./-]{1,60}$/).optional() }),
  titleFa: (a) => `ساخت استقرار خودکار (CI/CD) برای ${a.app}`,
  async execute(a, ctx) {
    const app = await ctx.liara.getApp(a.app);
    if (!app) return { ok: false, summaryFa: `اپ ${a.app} پیدا نشد`, error: "app not found" };
    const setup: CiSetup = {
      app: a.app,
      path: ".github/workflows/liara.yaml",
      content: ciWorkflow(a.app, { port: app.port, branch: a.branch, teamId: ctx.config.liara.teamId || undefined }),
      stepsFa: [
        "در مخزن گیت‌هاب: Settings ← Secrets and variables ← Actions ← New repository secret؛ نام را LIARA_API_TOKEN بگذارید و مقدارش را از console.liara.ir/API کپی کنید.",
        "فایل زیر را در مسیر .github/workflows/liara.yaml مخزن بگذارید و push کنید. از این به بعد هر push خودکار روی لیارا منتشر می‌شود.",
      ],
      docsUrl: "https://docs.liara.ir/paas/cicd/github/",
    };
    ctx.emit({ type: "ci_setup", setup });
    return {
      ok: true,
      summaryFa: "فایل CI/CD آماده شد؛ دو قدم با شماست",
      data: { ...setup, note: "We cannot write to the user's GitHub repo or its secrets; those two steps are the user's." },
    };
  },
});
