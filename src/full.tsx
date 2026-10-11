import React from "react";
import { createRoot } from "react-dom/client";
import App from "../web/src/App";
import { initialize } from "../web/src/storage";
import type { Platform, UpdateProps } from "../web/src/platform";
import WalletUpdates from "./WalletUpdates";
import { call } from "./api";
import "../web/src/signal.css";
function ConnectedSites() {
  const [state, setState] = React.useState<any>(null);
  const [error, setError] = React.useState("");
  const refresh = () => call("state").then(setState);
  React.useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section className="panel">
      <h2>Website connections</h2>
      <p>
        Unlock the selected wallet in the extension popup before connecting a
        website. Every payment requires your approval.
      </p>
      <button
        className="button"
        onClick={() =>
          void chrome.windows.create({
            url: chrome.runtime.getURL("popup.html?page=sites&tab=1"),
            type: "popup",
            width: 440,
            height: 760,
          })
        }
      >
        Manage website access
      </button>
      {state?.requests?.map((r: any) => (
        <a
          className="setting-row"
          key={r.id}
          href={`popup.html?request=${r.id}`}
          target="_blank"
        >
          {r.origin} · Review {r.type}
        </a>
      ))}
      {Object.keys(state?.sites ?? {}).map((origin) => (
        <div className="setting-row" key={origin}>
          <span>{origin}</span>
          <button
            className="button"
            onClick={() =>
              void call("revoke", { origin })
                .then(refresh)
                .catch((e) => setError(e.message))
            }
          >
            Disconnect
          </button>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
function Updates(p: UpdateProps) {
  return (
    <>
      <WalletUpdates blocked={p.blocked} compact={!p.details} />
      {p.details && <ConnectedSites />}
    </>
  );
}
const adapter: Platform = {
  kind: "extension",
  load: () => call("fullStateLoad"),
  save: (revision, key, value) =>
    call("fullStateSave", { revision, key, value }),
  core: (op, args) => call("fullCore", { op, input: JSON.stringify(args) }),
  rpc: (method, params) => call("fullRpc", { method, params }),
  protocol: (method,params) => call("fullProtocol",{method,params}),
  lock: () => {
    void call("lock").catch(() => {});
  },
  download: async (text, name) => {
    const url = URL.createObjectURL(
      new Blob([text + "\n"], { type: "application/octet-stream" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  },
  updates: (p) => <Updates {...p} />,
};
window.__REQUANT_PLATFORM__ = adapter;
await initialize();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
