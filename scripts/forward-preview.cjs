// CI-only transparent TCP forwarding to a Docker-inspected internal address.
// The browser uses trustworthy loopback; application headers stay unmodified.
const net = require("node:net");
const host = process.env.CONTAINER_HOST ?? "";
const port = Number(process.env.FORWARD_PORT);
if (
  process.env.CI !== "true" ||
  net.isIP(host) !== 4 ||
  !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
  ![8088, 8089].includes(port)
) throw Error("Explicit CI internal container target and preview port required");
net.createServer((client) => {
  const upstream = net.connect(8080, host);
  client.pipe(upstream).pipe(client);
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
  client.on("close", () => upstream.destroy());
  upstream.on("close", () => client.destroy());
}).listen(port, "127.0.0.1");
