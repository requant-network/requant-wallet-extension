// Pinned public request contract from requant-wallet/gateway/server.mjs at 1ba9aeb.
export function validateRequest(body) {
  const { method, params } = body || {};
  if (!Array.isArray(params)) throw new Error("Invalid parameters");
  const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const valid =
    (method === "getinfo" && params.length === 0) ||
    (method === "getblock" && params.length === 1 && params[0] === 0) ||
    ((method === "gettx" || method === "utxos") &&
      params.length === 1 &&
      hash(params[0])) ||
    (method === "history" &&
      params.length === 2 &&
      hash(params[0]) &&
      Number.isInteger(params[1]) &&
      params[1] >= 1 &&
      params[1] <= 100) ||
    (method === "sendtx" &&
      params.length === 1 &&
      typeof params[0] === "string" &&
      params[0].length >= 2 &&
      params[0].length <= 200000 &&
      params[0].length % 2 === 0 &&
      /^[a-f0-9]+$/.test(params[0]));
  if (!valid) throw new Error("Unsupported wallet operation");
  return { method, params };
}
