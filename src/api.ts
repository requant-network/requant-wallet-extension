import type { State } from "./types";
const empty: State = {
  wallets: [],
  selected: null,
  unlocked: false,
  sites: {},
  outbox: [],
  requests: [],
};
export const preview =
  import.meta.env.DEV && new URLSearchParams(location.search).has("preview");
let previewState: State = {
  ...empty,
  wallets: [
    {
      id: "preview",
      name: "Everyday wallet",
      address:
        "trq1qh9mdnatahxph5au6h8gdpn7dwjru99wawx0l272kyrfhtgwcfu7szm9zyc",
      owner: "",
      publicKey: "",
      backedUp: true,
    },
  ],
  selected: "preview",
  unlocked: true,
};
export async function call<T = unknown>(
  action: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (preview) {
    if (action === "state") return structuredClone(previewState) as T;
    if (action === "lock") {
      previewState.unlocked = false;
      return true as T;
    }
    if (action === "unlock") {
      if (args.password !== "test-only-no-funds-password")
        throw new Error("Wrong test fixture password.");
      previewState.unlocked = true;
      return true as T;
    }
    if (action === "touch") return true as T;
    if (action === "snapshot")
      return {
        confirmed: "0.00000000",
        spendable: "0.00000000",
        pending: "0.00000000",
        maturing: "0.00000000",
        observedAt: Date.now(),
        info: { height: "407", peers: "6", tip: "" },
        events: [],
      } as T;
    if (action === "plan")
      throw new Error("Preview fixture has no spendable funds.");
    throw new Error("Use the installed extension for this action.");
  }
  if (!globalThis.chrome?.runtime?.id)
    throw new Error(
      "Load this folder as a browser extension to use the wallet.",
    );
  const response = await chrome.runtime.sendMessage({
    channel: "requant-ui",
    action,
    args,
  });
  if (!response?.ok)
    throw new Error(
      response?.error?.message ??
        "The wallet is unavailable. Try opening it again.",
    );
  return response.result as T;
}
