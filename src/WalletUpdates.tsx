import { useEffect, useState } from "react";
import { call, preview } from "./api";
type Offer = {
  current: string;
  available: boolean;
  version?: string;
  unpacked: boolean;
  browserReady: boolean;
  browserVersion?: string;
  url?: string;
  error?: string;
};
export default function WalletUpdates({
  blocked,
  compact = false,
}: {
  blocked: boolean;
  compact?: boolean;
}) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [working, setWorking] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  async function refresh(force = false) {
    if (preview) return;
    setWorking(true);
    try {
      setOffer(await call<Offer>(force ? "checkUpdates" : "updateStatus"));
    } finally {
      setWorking(false);
    }
  }
  useEffect(() => {
    void refresh().catch(() => {});
    const timer = setInterval(() => void refresh().catch(() => {}), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!offer || (compact && !offer.available && !offer.browserReady))
    return null;
  return (
    <section className="card update-card" aria-live="polite">
      <h3>Wallet updates · v{offer.current}</h3>
      <p>
        {offer.browserReady
          ? `Version ${offer.browserVersion} is ready to install.`
          : offer.available
            ? `Version ${offer.version} is available.`
            : offer.error ||
              "You are up to date. Automatic checks are enabled."}
      </p>
      {offer.unpacked && (
        <p className="muted">
          ZIP installation: replace files in the existing extension folder, then
          click Reload in your browser's Extensions page. Keep the same folder
          and extension installed to preserve your wallets. Store installations
          update automatically.
        </p>
      )}
      {offer.browserReady && !offer.unpacked && (
        <button
          className="primary"
          disabled={blocked || working}
          onClick={() => void call("applyBrowserUpdate").catch(() => {})}
        >
          Install update
        </button>
      )}
      {offer.available && offer.unpacked && (
        <button
          className="primary"
          disabled={blocked || working}
          onClick={async () => {
            setWorking(true);
            setDownloadError("");
            try {
              const file = await call<{ base64: string; name: string }>(
                "downloadVerifiedUpdate",
              );
              const bytes = Uint8Array.from(atob(file.base64), (c) =>
                c.charCodeAt(0),
              );
              const url = URL.createObjectURL(
                new Blob([bytes], { type: "application/zip" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = file.name;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 60_000);
            } catch (e) {
              setDownloadError(e instanceof Error ? e.message : String(e));
            } finally {
              setWorking(false);
            }
          }}
        >
          Download verified update
        </button>
      )}
      {downloadError && <p role="alert">{downloadError}</p>}
      {!compact && (
        <button
          className="secondary"
          disabled={working}
          onClick={() => void refresh(true).catch(() => {})}
        >
          {working ? "Checking…" : "Check for updates"}
        </button>
      )}
    </section>
  );
}
