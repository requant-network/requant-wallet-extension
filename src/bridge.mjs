(() => {
  if (globalThis.__requantBridge) return;
  globalThis.__requantBridge = true;
  const pending = new Set();
  window.addEventListener("message", async (event) => {
    const m = event.data;
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      m?.channel !== "requant-request-v1" ||
      typeof m.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(m.id) ||
      pending.has(m.id) ||
      pending.size >= 10
    )
      return;
    pending.add(m.id);
    const reply = (result, error) =>
      window.postMessage(
        { channel: "requant-response-v1", id: m.id, result, error },
        location.origin,
      );
    try {
      let res = await chrome.runtime.sendMessage({
        channel: "requant-provider",
        action: "request",
        method: m.method,
        params: m.params,
      });
      if (!res.ok) {
        reply(undefined, res.error);
        return;
      }
      let value = res.result;
      const start = Date.now();
      const requestId = value.id;
      while (!value.done) {
        if (Date.now() - start > 300_000)
          throw new Error("Wallet approval timed out.");
        await new Promise((resolve) => setTimeout(resolve, 500));
        res = await chrome.runtime.sendMessage({
          channel: "requant-provider",
          action: "poll",
          id: requestId,
        });
        if (!res.ok) {
          reply(undefined, res.error);
          return;
        }
        value = res.result;
      }
      reply(value.result, value.error);
    } catch {
      reply(undefined, {
        code: 4001,
        message: "Wallet connection closed or request expired.",
      });
    } finally {
      pending.delete(m.id);
    }
  });
})();
