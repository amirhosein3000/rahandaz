# Official challenge spec (as given by the user, 2026-10-21)

## Original (Persian)

چالش لیارا باید یه ایجنت طراحی بشه برای راه اندازی انتشار و دیپلوی و بررسی عملکرد و باگ های سایت و کارای دواپسی
فرض اینه که یه برنامه نویسی یه برنامه ای طراحی کرده ولی هیچی از دیپلوی نمیدونه و ایجنت ما باید راهنماییش کنه
در حال حاضر پلتفورم از سرویس داریمی تو لیارا ما میخوایم این فرایند رو ساده تر و کوتاه تر کنیم و human in the loop باید باشه
ایجنت یه سری تاییداشو از ادم بگیره پوزیشن داریم به اسم SRE
ما میخوایم ایجنتمون این کارا روهم انجام بده و بررسی کنه و لاگ مطالعه کنه در واقع sre ایجنت هم میخوایم
حالا نمیخوایم 24 ساعته پایش بکنه ولی باید مشکل و اینارو بفهمه
و بررسی کنه و گذارش و پیشنهاد بده و حتی گاهی باید فیکس کنه مشکلات رو
از سرویس و اعتبار های لیارا میتونیم استفاده کنیم
تجربه کاربری راحت و خوب خیلی مهمه
ui هم خیلی مهمه
سریع باید باشه و خوب باشه تجربه کاربری

## English reading

1. Build an agent for **launch, release and deploy**, plus **checking the performance and bugs of a site**
   and general DevOps work.
2. Persona: a developer who built an app but **knows nothing about deployment**; the agent must **guide** them.
3. Liara's platform services exist today; the goal is to make the process **simpler and shorter**.
4. **Human in the loop**: the agent gets approvals from the person.
5. **SRE agent**: like the SRE role, it investigates, **reads logs**, understands problems. Not 24/7
   monitoring, but it must detect and investigate issues, **report and recommend**, and sometimes **fix**.
6. Liara's services and credits may be used.
7. **UX is very important; UI is very important; it must be fast.**

Not stated (ask): judging criteria/weights, deliverables, deadline, whether "Liara's services and credits"
includes Liara AI as the agent's LLM.

---

# Full brief (second message, 2026-10-21): capabilities, constraints, deliverables, scoring

(There is also an intro video; it could not be watched from this environment. Anything it adds should be
written down here.)

## Expected capabilities

**Initial setup & first deploy**
- Guide the user to the right deployment method and the initial setup of the website.
- Check project requirements; suggest the right Liara infrastructure and plan for the project type and resources.
- Help with the initial setup, configuration and deploy steps.
- Guide domain setup, including the steps in the domain registrar panel (e.g. IRNIC) when needed.
- Simplify setup until the user only does the steps that are essential and outside the assistant's reach.

**Deployment & operations**
- Help publish new versions of the website.
- Do or guide configuration and service management via Liara's APIs.
- Check service status and find errors in the deploy process.
- Automate repetitive operations; reduce manual technical steps.

**Monitoring & maintenance**
- Check service health and resource use (CPU, RAM) where the data is available.
- Fetch and analyse the service's logs.
- Help investigate slowness, disruption, rising resource use.
- Suggest performance and stability improvements.
- Take corrective action, or guide the user to fix it.

**Intelligent troubleshooting** (e.g. HTTP 500): collect related information from available sources; check
logs, service status and resource data; identify and **prioritise** probable causes; propose a fix; with
permission, apply it **and verify the result**. Example: a slow site → is it RAM, CPU limits, app errors or
something else? → suggest the right fix.

**Human-in-the-loop**: approval before sensitive/high-impact operations (risky config changes, restarts,
plan/resource changes). Distinguish low-risk operations that can run automatically from sensitive ones that
need approval. Results and errors of operations must be visible to the user.

## Technical constraints
- Use Liara's APIs for information and infrastructure operations.
- Any approach: AI agent, MCP, or both. Any UI: custom, chat, CLI, other. Architecture is free.
- Use only what Liara's APIs really offer; where something is not available via API, **say so clearly to the user**.

## UX requirements (one of the most important criteria)
Turn complex infrastructure work into a simple, understandable, trustworthy experience. The user should be able to:
state the request with minimal technical knowledge; understand the status of operations; evaluate the
assistant's suggestions; approve operations when needed.

## Vision
A technical teammate for website owners: from the first deploy and choosing resources to ongoing monitoring,
problem detection and keeping the service stable, so the owner can focus on the product.

## Deliverables
- A runnable **MVP** covering a clear part of the setup / deploy / maintenance cycle, showing a **real
  scenario** from the user's request to the operation or diagnosis.
- An **md document on GitHub**: short architecture; how it connects to Liara's APIs; limitations; how the user
  interacts with the system.
- **Demo video (mandatory)**, about 5 minutes, showing and explaining the product (no source code needed).
  No video = disqualified. Video quality counts. Voice-over strongly preferred.

## Scoring (300)
| # | Criterion | What is judged | Points |
|---|---|---|---|
| 1 | Technical function & Liara integration | Liara API connection, setup & deploy, service management, successful infra operations | 100 |
| 2 | Intelligence & problem solving | Log analysis, error detection, probable causes, solution, verifying corrective actions | 100 |
| 3 | UX | Simple interaction, understandable suggestions, operation status, approval handling for sensitive actions | 50 |
| 4 | Stability, maintenance, operational security | Health & resource monitoring, automating repetitive ops, safe sensitive actions, announcing API limits | 50 |
