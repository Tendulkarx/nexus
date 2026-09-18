import { createServer, type Server } from "net";

import { describe, it, expect, afterEach } from "vitest";

import { checkReachable } from "./reachability.js";

describe("checkReachable", () => {
  let server: Server | null = null;

  afterEach(() => {
    server?.close();
    server = null;
  });

  it("resolves true when a listener accepts the connection", async () => {
    server = createServer();
    const port = await new Promise<number>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve((server!.address() as { port: number }).port));
    });

    await expect(checkReachable("127.0.0.1", port)).resolves.toBe(true);
  });

  it("resolves false when the port refuses the connection", async () => {
    // Bind then immediately close to get a port that's guaranteed closed.
    const closed = createServer();
    const port = await new Promise<number>((resolve) => {
      closed.listen(0, "127.0.0.1", () => resolve((closed.address() as { port: number }).port));
    });
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    await expect(checkReachable("127.0.0.1", port)).resolves.toBe(false);
  });
});
