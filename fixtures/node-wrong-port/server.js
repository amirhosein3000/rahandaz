const http = require("node:http");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "orders" }));
});

// Hard-coded port: liara.json says 3000, but this listens on 8080.
server.listen(8080, () => console.log("Server listening on http://0.0.0.0:8080"));
