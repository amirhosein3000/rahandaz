const http = require("node:http");
http.createServer((_, res) => res.end("ok")).listen(process.env.PORT || 3000);
