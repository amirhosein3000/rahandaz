import { describe, expect, it } from "vitest";
import { checkWriteRequest } from "./server";

const req = (headers: Record<string, string>) => new Request("http://localhost:3200/api/runs", { method: "POST", headers });
const dev = { production: false, allowOpen: false };

describe("console write-request guard", () => {
  it("accepts a same-origin JSON request", () => {
    expect(checkWriteRequest(req({ "content-type": "application/json", origin: "http://localhost:3200", host: "localhost:3200", "sec-fetch-site": "same-origin" }), dev)).toBeNull();
  });
  it("rejects non-JSON bodies (form/text CSRF)", () => {
    expect(checkWriteRequest(req({ "content-type": "text/plain", host: "localhost:3200" }), dev)?.status).toBe(415);
  });
  it("rejects cross-site requests", () => {
    expect(checkWriteRequest(req({ "content-type": "application/json", "sec-fetch-site": "cross-site", host: "localhost:3200" }), dev)?.status).toBe(403);
    expect(checkWriteRequest(req({ "content-type": "application/json", origin: "https://evil.example", host: "localhost:3200" }), dev)?.status).toBe(403);
  });
  it("honours a reverse proxy's forwarded host", () => {
    expect(checkWriteRequest(req({ "content-type": "application/json", origin: "https://rahandaz.liara.run", host: "10.0.0.5:3000", "x-forwarded-host": "rahandaz.liara.run" }), dev)).toBeNull();
  });
  it("a production console without a password refuses changes", () => {
    const r = req({ "content-type": "application/json", host: "x" });
    expect(checkWriteRequest(r, { production: true, allowOpen: false })?.status).toBe(403);
    expect(checkWriteRequest(r, { production: true, allowOpen: false, password: "p" })).toBeNull();
    expect(checkWriteRequest(r, { production: true, allowOpen: true })).toBeNull();
  });
});
