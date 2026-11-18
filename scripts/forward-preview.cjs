// CI-only transparent TCP forwarding to a Docker-inspected internal address.
// The browser uses trustworthy loopback; application headers stay unmodified.
const net = require("node:net");
exports.forwardPreview = async (host, port) => {
  if (
    process.env.CI !== "true" ||
    net.isIP(host) !== 4 ||
    !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    ![8088, 8089].includes(port)
  )
    throw Error(
      "Explicit CI internal container target and preview port required",
    );
  const sockets = new Set();
  const server = net.createServer((client) => {
    const upstream = net.connect(8080, host);
    sockets.add(client);
    sockets.add(upstream);
    client.pipe(upstream).pipe(client);
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.on("close", () => {
      sockets.delete(client);
      upstream.destroy();
    });
    upstream.on("close", () => {
      sockets.delete(upstream);
      client.destroy();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return () =>
    new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(resolve);
    });
};
