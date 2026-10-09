(() => {
  if (window.requant?.isRequant) return;
  const waiting = new Map();
  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.channel !== "requant-response-v1"
    )
      return;
    const p = waiting.get(event.data.id);
    if (!p) return;
    clearTimeout(p.timer);
    waiting.delete(event.data.id);
    if (event.data.error) {
      const e = new Error(event.data.error.message);
      e.code = event.data.error.code;
      p.reject(e);
    } else p.resolve(event.data.result);
  });
  const request = ({ method, params } = {}) =>
    new Promise((resolve, reject) => {
      if (typeof method !== "string") {
        reject(new Error("A Requant method is required."));
        return;
      }
      if (waiting.size >= 10) {
        reject(new Error("Too many pending wallet requests."));
        return;
      }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        waiting.delete(id);
        const e = new Error("Wallet request timed out.");
        e.code = 4001;
        reject(e);
      }, 310_000);
      waiting.set(id, { resolve, reject, timer });
      window.postMessage(
        { channel: "requant-request-v1", id, method, params },
        location.origin,
      );
    });
  Object.defineProperty(window, "requant", {
    value: Object.freeze({ isRequant: true, version: "0.1.0", request }),
    configurable: false,
    writable: false,
  });
  window.dispatchEvent(new Event("requant#initialized"));
})();
