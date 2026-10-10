export function validateRequest(body) {
  const { method, params } = body || {};
  if (!Array.isArray(params)) throw new Error("Invalid parameters");
  const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const owners = (v) =>
    hash(v) ||
    (Array.isArray(v) &&
      v.length >= 1 &&
      v.length <= 200 &&
      new Set(v).size === v.length &&
      v.every(hash));
  const valid =
    (method === "getinfo" && params.length === 0) ||
    (method === "estimatefee" &&
      params.length === 1 &&
      [1, 3, 10].includes(params[0])) ||
    (method === "gettxbatch" &&
      params.length === 1 &&
      Array.isArray(params[0]) &&
      params[0].length >= 1 &&
      params[0].length <= 100 &&
      params[0].every(hash)) ||
    (method === "getblock" && params.length === 1 && params[0] === 0) ||
    (method === "gettx" && params.length === 1 && hash(params[0])) ||
    (method === "utxos" && params.length === 1 && owners(params[0])) ||
    (method === "history" &&
      params.length === 2 &&
      owners(params[0]) &&
      Number.isInteger(params[1]) &&
      params[1] >= 1 &&
      params[1] <= 200) ||
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
