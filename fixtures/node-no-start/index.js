const http = require("node:http");

const port = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("notes api ok\n");
  })
  .listen(port, () => console.log(`notes api on ${port}`));
