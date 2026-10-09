import test from "node:test";
import assert from "node:assert/strict";
import { validateRequest } from "./gateway-contract.mjs";
test("public gateway accepts sendtx signed bytes and rejects an invented internal RPC method", () => {
  assert.deepEqual(validateRequest({ method: "sendtx", params: ["0100"] }), {
    method: "sendtx",
    params: ["0100"],
  });
  assert.throws(
    () => validateRequest({ method: "signedsendtx", params: ["0100"] }),
    /Unsupported/,
  );
  assert.throws(
    () => validateRequest({ method: "sendtx", params: ["xyz"] }),
    /Unsupported/,
  );
});
