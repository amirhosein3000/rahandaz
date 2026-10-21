const http = require("node:http");
const crypto = require("node:crypto");

if (!process.env.SESSION_SECRET) throw new Error("Missing required environment variable: SESSION_SECRET");

const port = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    const sig = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(req.url).digest("hex").slice(0, 8);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, shop: "demo", sig }));
  })
  .listen(port, () => console.log(`Server listening on http://0.0.0.0:${port}`));
