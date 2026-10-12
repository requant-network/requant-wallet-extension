import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Copy,
  Check,
  LockKeyhole,
  ShieldCheck,
  ChevronLeft,
  ExternalLink,
  RefreshCw,
  Globe,
  Settings,
  Wallet as WalletIcon,
  Activity,
  Download,
  Plus,
  X,
  Link2,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
} from "lucide-react";
import { call, preview } from "./api";
import { initialPage, dedicatedPageUrl } from "./navigation.mjs";
import { short, rqt } from "./amounts.mjs";
import { createSnapshotRefresh } from "./snapshot-refresh.mjs";
import WalletUpdates from "./WalletUpdates";
import type { Wallet, State, Snapshot, Review, SiteRequest } from "./types";
import "./style.css";
import "./signal.css";
type Page =
  | "home"
  | "receive"
  | "send"
  | "activity"
  | "settings"
  | "create"
  | "restore"
  | "backup"
  | "password"
  | "review"
  | "result"
  | "sites";
const empty: State = {
  wallets: [],
  selected: null,
  unlocked: false,
  sites: {},
  outbox: [],
  requests: [],
};
function App() {
  const [state, setState] = useState<State>(empty),
    [loaded, setLoaded] = useState(false),
    [page, setPage] = useState<Page>(
      () => initialPage(location.search) as Page,
    ),
    [snapshot, setSnapshot] = useState<Snapshot>(),
    [nodeError, setNodeError] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [qr, setQr] = useState(""),
    [review, setReview] = useState<Review>(),
    [result, setResult] = useState<{
      txid: string;
      status: string;
      message: string;
    }>(),
    [backup, setBackup] = useState<{
      id: string;
      encrypted: string;
      address: string;
    }>(),
    [saved, setSaved] = useState(false),
    [currentSite, setCurrentSite] = useState<{
      origin: string;
      tabId: number;
    }>(),
    [notice, setNotice] = useState("");
  const requestParam = new URLSearchParams(location.search).get("request");
  const request: SiteRequest | undefined = requestParam
    ? state.requests.find((r) => r.id === requestParam)
    : undefined;
  const wallet = state.wallets.find(
    (w) =>
      w.id === (request?.type === "send" ? request.walletId : state.selected),
  );
  const snapshotRefresh = useRef<ReturnType<
    typeof createSnapshotRefresh
  > | null>(null);
  async function refresh() {
    const s = await call<State>("state");
    setState(s);
    setLoaded(true);
    return s;
  }
  async function loadSnapshot() {
    await snapshotRefresh.current?.refresh();
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const nav = (p: Page) => {
    const target = dedicatedPageUrl(
      p,
      location.search,
      globalThis.chrome?.runtime?.id ? chrome.runtime.getURL("") : "",
      preview,
    );
    if (p === "create" || p === "restore") {
      void chrome.tabs.create({ url: chrome.runtime.getURL("full.html") });
      return;
    }
    if (target) {
      chrome.tabs.create({ url: target }).catch((e) => setError(e.message));
      return;
    }
    document.querySelector("main")?.scrollTo(0, 0);
    setPage(p);
    setError("");
    setNotice("");
    setBackup(undefined);
    setSaved(false);
  };
  useEffect(() => {
    refresh().catch((e) => {
      setError(e.message);
      setLoaded(true);
    });
    const t = setInterval(() => {
      refresh().catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setSnapshot(undefined);
    setNodeError("");
    if (!state.unlocked || !state.selected) return;
    const controller = createSnapshotRefresh({
      load: () => call<Snapshot>("snapshot"),
      onSnapshot: (s: Snapshot) => {
        setSnapshot(s);
        setNodeError("");
      },
      onError: (e: Error) =>
        setNodeError(e.message || "Node connection is unavailable."),
    });
    snapshotRefresh.current = controller;
    void controller.refresh();
    return () => {
      controller.dispose();
      if (snapshotRefresh.current === controller)
        snapshotRefresh.current = null;
    };
  }, [state.unlocked, state.selected]);
  useEffect(() => {
    if (
      request?.type === "send" &&
      request.walletId &&
      request.walletId !== state.selected
    )
      call("select", { id: request.walletId })
        .then(refresh)
        .catch((e) => setError(e.message));
  }, [request?.walletId, state.selected]);
  useEffect(() => {
    let active = true;
    if (wallet)
      QRCode.toDataURL(wallet.address, {
        margin: 1,
        width: 212,
        color: { dark: "#171717", light: "#fbfaf7" },
      }).then((x) => {
        if (active) setQr(x);
      });
    return () => {
      active = false;
    };
  }, [wallet?.address]);
  useEffect(() => {
    if (page !== "sites" || preview) return;
    chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
      try {
        const u = new URL(t.url ?? "");
        if (u.protocol === "https:" && t.id !== undefined)
          setCurrentSite({ origin: u.origin, tabId: t.id });
        else setCurrentSite(undefined);
      } catch {
        setCurrentSite(undefined);
      }
    });
  }, [page]);
  useEffect(() => {
    let last = 0;
    const touch = () => {
      if (!state.unlocked || Date.now() - last < 30_000) return;
      last = Date.now();
      call("touch").catch(() => {});
    };
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, [state.unlocked]);
  function fields(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    return Object.fromEntries(
      new FormData(e.currentTarget).entries(),
    ) as Record<string, string>;
  }
  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  const money = (text?: string) => text ?? "—";
  const goBack = () => nav("home");
  const explorer = (txid: string) =>
    `https://requant.network/explorer/tx/${encodeURIComponent(txid)}`;
  const footer = (
    <div className="trust">
      <ShieldCheck size={13} /> Local keys. Your confirmation.
      <span>v0.5.0</span>
    </div>
  );
  const errorBox = error && (
    <div className="alert error" role="alert">
      <AlertCircle size={16} />
      <span>{error}</span>
      <button
        className="icon tiny"
        aria-label="Dismiss error"
        onClick={() => setError("")}
      >
        <X size={14} />
      </button>
    </div>
  );
  const submit = (label: string) => (
    <button className="primary full" disabled={busy} type="submit">
      {busy ? <LoaderCircle className="spin" size={18} /> : null}
      {busy ? "Working locally…" : label}
    </button>
  );
  const passwordField = (
    label = "Wallet password",
    name = "password",
    isNew = false,
  ) => (
    <label>
      {label}
      <input
        name={name}
        type="password"
        required
        maxLength={1024}
        minLength={isNew ? 10 : 1}
        autoComplete={isNew ? "new-password" : "current-password"}
        placeholder={
          isNew ? "At least 10 characters" : "Enter your wallet password"
        }
      />
    </label>
  );
  let content: React.ReactNode;
  if (!loaded) {
    content = (
      <div className="center splash">
        <img src="/requant-mark.svg" width="66" alt="" />
        <LoaderCircle className="spin" />
        <p>Opening your wallet…</p>
      </div>
    );
  } else if (page === "create" || page === "restore") {
    const restoring = page === "restore";
    content = (
      <>
        <button className="back" onClick={goBack}>
          <ChevronLeft size={16} />
          Back
        </button>
        <div className="page-title">
          <div className="symbol">
            <Plus />
          </div>
          <h1>{restoring ? "Bring your wallet." : "Make it yours."}</h1>
          <p>
            {restoring
              ? "Restore an encrypted Requant backup from your app or another browser."
              : "A fresh testnet wallet, created on this device."}
          </p>
        </div>
        <form
          onSubmit={(e) => {
            const f = fields(e),
              form = e.currentTarget;
            const input =
              e.currentTarget.querySelector<HTMLInputElement>(
                "input[type=file]",
              );
            run(async () => {
              if (!restoring && f.password !== f.confirm)
                throw new Error("Passwords do not match.");
              let encrypted: string | undefined;
              if (restoring) {
                const file = input?.files?.[0];
                if (!file || file.size > 4096)
                  throw new Error(
                    "Choose an encrypted Requant key file up to 4 KB.",
                  );
                encrypted = await file.text();
              }
              await call("add", {
                name: f.name,
                password: f.password,
                ...(encrypted ? { encrypted } : {}),
              });
              form.reset();
              nav(restoring ? "home" : "backup");
            });
          }}
        >
          <label>
            Wallet name
            <input
              name="name"
              placeholder="Everyday wallet"
              maxLength={40}
              required
              defaultValue="My Requant wallet"
            />
          </label>
          {restoring && (
            <label>
              Encrypted backup
              <input type="file" accept=".key,.txt" required />
              <small>
                Requant encrypted key file • No recovery phrase required
              </small>
            </label>
          )}
          {passwordField(
            restoring ? "Backup password" : "Create a wallet password",
            "password",
            !restoring,
          )}
          {!restoring && passwordField("Confirm password", "confirm", true)}
          <div className="note">
            <ShieldCheck size={16} />
            <span>
              {restoring
                ? "Your backup stays on this device. The server never receives it."
                : "You will save an encrypted backup next. Keep the backup and password somewhere safe."}
            </span>
          </div>
          {submit(restoring ? "Restore wallet" : "Create wallet")}
        </form>
      </>
    );
  } else if (!wallet) {
    content = (
      <>
        <div className="welcome-art">
          <div className="orbit one" />
          <div className="orbit two" />
          <img src="/requant-mark.svg" alt="Requant" />
        </div>
        <div className="page-title center">
          <div className="eyebrow">REQUANT, IN YOUR BROWSER</div>
          <h1>
            Your keys.
            <br />
            Your next move.
          </h1>
          <p>
            A small wallet for a new network.
            <br />
            Built around your control.
          </p>
        </div>
        <button className="primary full" onClick={() => nav("create")}>
          Create a wallet <ArrowUpRight size={18} />
        </button>
        <button className="secondary full" onClick={() => nav("restore")}>
          I already have a wallet
        </button>
        <div className="note">
          <AlertCircle size={16} />
          <span>Testnet only. Test RQT has no monetary value.</span>
        </div>
      </>
    );
  } else if (!state.unlocked) {
    content = (
      <>
        <div className="locked-art">
          <img src="/requant-mark.svg" alt="" />
          <span>
            <LockKeyhole size={24} />
          </span>
        </div>
        <div className="page-title center">
          <div className="eyebrow">WELCOME BACK</div>
          <h1>Your wallet awaits.</h1>
          <p>Unlock {wallet.name} to continue.</p>
        </div>
        <form
          onSubmit={(e) => {
            const f = fields(e),
              form = e.currentTarget;
            run(async () => {
              await call("unlock", { password: f.password });
              form.reset();
            });
          }}
        >
          {passwordField()}
          {submit("Unlock wallet")}
        </form>
        <button className="text full" onClick={() => nav("restore")}>
          Restore another wallet
        </button>
      </>
    );
  } else if (requestParam && !request && page !== "result") {
    content = (
      <div className="center empty">
        <CheckCircle2 size={38} />
        <h1>Request closed.</h1>
        <p>This request was handled, expired, or its website changed.</p>
        <button className="secondary" onClick={() => window.close()}>
          Close window
        </button>
      </div>
    );
  } else if (request?.type === "connect") {
    content = (
      <>
        <div className="page-title center">
          <div className="symbol">
            <Globe />
          </div>
          <h1>Connect this site?</h1>
          <p>
            Let this website see your selected public address and request
            transfers.
          </p>
        </div>
        <div className="site-box">
          <Globe size={18} />
          <strong>{request.origin}</strong>
        </div>
        <div className="account-card">
          <WalletIcon />
          <div>
            <strong>{wallet.name}</strong>
            <span className="mono">{short(wallet.address, 12, 10)}</span>
          </div>
          <CheckCircle2 size={17} />
        </div>
        <div className="note">
          <ShieldCheck size={16} />
          <span>
            Each transfer still needs a separate review and your wallet
            password.
          </span>
        </div>
        <div className="split">
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await call("reject", { id: request.id });
              })
            }
          >
            Reject
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await call("approve", { id: request.id });
              })
            }
          >
            Connect
          </button>
        </div>
      </>
    );
  } else if (page === "review" && review) {
    content = (
      <>
        <button className="back" onClick={() => nav(request ? "home" : "send")}>
          <ChevronLeft size={16} />
          Back
        </button>
        <div className="page-title">
          <div className="symbol">
            <ArrowUpRight />
          </div>
          <h1>Review transfer.</h1>
          <p>
            {request
              ? "Requested by " + request.origin
              : "Check the details before signing locally."}
          </p>
        </div>
        <div className="review-amount">
          <span>You send</span>
          <strong>
            {review.amount}
            <small>RQT</small>
          </strong>
        </div>
        <div className="card details">
          <label>
            From<strong>{review.walletName}</strong>
            <code>{review.address}</code>
          </label>
          <label>
            To<code>{review.recipient}</code>
          </label>
          <div>
            <span>Network fee</span>
            <strong className="mono">{review.fee} RQT</strong>
          </div>
          <div className="total">
            <span>Total</span>
            <strong className="mono">{review.total} RQT</strong>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            const f = fields(e),
              form = e.currentTarget;
            run(async () => {
              const r = await call<{
                txid: string;
                status: string;
                message: string;
              }>("send", { id: review.id, password: f.password });
              form.reset();
              setResult(r);
              setPage("result");
              await loadSnapshot();
            });
          }}
        >
          {passwordField("Confirm with your wallet password")}
          <div className="note">
            <AlertCircle size={16} />
            <span>Requant testnet • Review expires after two minutes.</span>
          </div>
          {submit("Sign & send")}
        </form>
      </>
    );
  } else if (page === "result" && result) {
    content = (
      <>
        <div className="page-title center">
          <div className="symbol">
            {result.status === "pending" ? <CheckCircle2 /> : <AlertCircle />}
          </div>
          <h1>
            {result.status === "pending"
              ? "On its way."
              : result.status === "unknown"
                ? "Check the explorer."
                : "Transfer rejected."}
          </h1>
          <p>{result.message}</p>
        </div>
        <div className="card">
          <span className="eyebrow">TRANSACTION ID</span>
          <code className="break">{result.txid}</code>
        </div>
        <a
          className="secondary full"
          href={explorer(result.txid)}
          target="_blank"
          rel="noreferrer"
        >
          View in explorer
          <ExternalLink size={16} />
        </a>
        <button
          className="primary full"
          onClick={() => (requestParam ? window.close() : goBack())}
        >
          {requestParam ? "Close window" : "Back to wallet"}
        </button>
      </>
    );
  } else if (page === "send" || (request?.type === "send" && page === "home")) {
    content = (
      <>
        <button className="back" onClick={goBack}>
          <ChevronLeft size={16} />
          Back
        </button>
        <div className="page-title">
          <div className="symbol">
            <ArrowUpRight />
          </div>
          <h1>{request ? "Website transfer." : "Send RQT."}</h1>
          <p>
            {request ? request.origin : "A clear destination. An exact amount."}
          </p>
        </div>
        {!wallet.backedUp ? (
          <>
            <div className="note">
              <AlertCircle size={16} />
              <span>Save your encrypted backup before sending funds.</span>
            </div>
            <button className="primary full" onClick={() => nav("backup")}>
              Save backup
            </button>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              const f = fields(e);
              run(async () => {
                const r = await call<Review>(
                  "plan",
                  request
                    ? { requestId: request.id }
                    : { recipient: f.recipient, amount: f.amount, fee: f.fee },
                );
                setReview(r);
                setPage("review");
              });
            }}
          >
            <label>
              Recipient address
              <textarea
                name="recipient"
                required
                rows={3}
                placeholder="trq1…"
                defaultValue={request?.params?.recipient}
                readOnly={!!request}
                maxLength={120}
              />
            </label>
            <label>
              Amount (RQT)
              <input
                name="amount"
                inputMode="decimal"
                required
                placeholder="0.00000000"
                defaultValue={request?.params?.amount}
                readOnly={!!request}
                maxLength={30}
              />
              <small>
                Available:{" "}
                <span className="mono">{money(snapshot?.spendable)} RQT</span>
              </small>
            </label>
            <label>
              {wallet && "hdFile" in wallet
                ? "Maximum network fee (RQT)"
                : "Network fee limit (RQT)"}
              <input
                name="fee"
                inputMode="decimal"
                defaultValue={request?.params?.fee ?? "0.0001"}
                required
                readOnly={!!request}
                maxLength={30}
              />
            </label>
            <div className="note">
              <ShieldCheck size={16} />
              <span>
                Only confirmed, spendable outputs are used. You review the total
                before signing.
              </span>
            </div>
            {submit("Review transfer")}
            {request && (
              <button
                type="button"
                className="secondary full"
                onClick={() =>
                  run(async () => {
                    await call("reject", { id: request.id });
                  })
                }
              >
                Reject request
              </button>
            )}
          </form>
        )}
      </>
    );
  } else if (page === "receive") {
    content = (
      <>
        <div className="page-title center receive-title">
          <h1>Receive RQT.</h1>
          <p>Your address on Requant testnet.</p>
        </div>
        <div className="qr">
          {qr && (
            <img
              src={qr}
              width="212"
              height="212"
              alt="Requant testnet receiving address QR code"
            />
          )}
          <span className="qr-corner" />
        </div>
        <div className="card address-card">
          <span className="eyebrow">YOUR TESTNET ADDRESS</span>
          <code>{wallet.address}</code>
        </div>
        <button
          className="primary full"
          onClick={() => run(() => copy(wallet.address))}
        >
          {copied ? <Check size={17} /> : <Copy size={17} />}{" "}
          {copied ? "Address copied" : "Copy address"}
        </button>
        <div className="note receive-note">
          <AlertCircle size={16} />
          <span>
            Send Requant testnet RQT only. Other assets are not supported.
          </span>
        </div>
      </>
    );
  } else if (page === "backup") {
    content = (
      <>
        <button className="back" onClick={goBack}>
          <ChevronLeft size={16} />
          Back
        </button>
        <div className="page-title">
          <div className="symbol">
            <ShieldCheck />
          </div>
          <h1>Keep a way back.</h1>
          <p>
            Save your encrypted key file. Your wallet password unlocks it on any
            Requant wallet.
          </p>
        </div>
        {!backup ? (
          <form
            onSubmit={(e) => {
              const f = fields(e),
                form = e.currentTarget;
              run(async () => {
                setBackup(await call("backup", { password: f.password }));
                form.reset();
              });
            }}
          >
            {passwordField()}
            {submit("Prepare encrypted backup")}
          </form>
        ) : (
          <>
            <div className="note">
              <ShieldCheck size={16} />
              <span>
                This file is encrypted. Keep it and your wallet password in
                separate safe places.
              </span>
            </div>
            <button
              className="primary full"
              onClick={() => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(
                  new Blob([backup.encrypted + "\n"], { type: "text/plain" }),
                );
                a.download = `requant-${backup.address.slice(-8)}.key`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
                setSaved(true);
              }}
            >
              <Download size={17} />
              Download encrypted backup
            </button>
            {saved && (
              <>
                <label className="checkbox">
                  <input type="checkbox" required id="saved-backup" />I saved
                  the file and know my wallet password.
                </label>
                <button
                  className="secondary full"
                  onClick={() =>
                    run(async () => {
                      if (
                        !document.querySelector<HTMLInputElement>(
                          "#saved-backup",
                        )?.checked
                      )
                        throw new Error("Confirm that you saved your backup.");
                      await call("markBackup", { id: backup.id });
                      nav("home");
                    })
                  }
                >
                  Backup saved
                </button>
              </>
            )}
          </>
        )}
        <div className="card muted">
          <h3>No recovery phrase.</h3>
          <p>
            Requant uses an encrypted key file. To restore, you need that file
            and its password.
          </p>
        </div>
      </>
    );
  } else if (page === "password") {
    content = (
      <>
        <button className="back" onClick={() => nav("settings")}>
          <ChevronLeft size={16} />
          Back
        </button>
        <div className="page-title">
          <h1>Change password.</h1>
          <p>
            Your existing backup keeps its old password. Save a fresh backup
            after changing it.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            const f = fields(e),
              form = e.currentTarget;
            run(async () => {
              if (f.nextPassword !== f.confirm)
                throw new Error("Passwords do not match.");
              await call("changePassword", {
                password: f.password,
                nextPassword: f.nextPassword,
              });
              form.reset();
              nav("home");
            });
          }}
        >
          {passwordField("Current password")}
          {passwordField("New password", "nextPassword", true)}
          {passwordField("Confirm new password", "confirm", true)}
          {submit("Update password & lock")}
        </form>
      </>
    );
  } else if (page === "sites") {
    content = (
      <>
        <button className="back" onClick={() => nav("settings")}>
          <ChevronLeft size={16} />
          Back
        </button>
        <div className="page-title">
          <h1>Your connections.</h1>
          <p>
            Choose which websites can request access to your public wallet
            address.
          </p>
        </div>
        {currentSite && (
          <div className="card">
            <span className="eyebrow">CURRENT WEBSITE</span>
            <p className="break">{currentSite.origin}</p>
            <button
              className="primary full"
              disabled={busy}
              onClick={async () => {
                setError("");
                try {
                  const granted = await chrome.permissions.request({
                    origins: [`${currentSite.origin}/*`],
                  });
                  if (!granted)
                    throw new Error("Website access was not granted.");
                  await run(async () => {
                    await call("enableSite", currentSite);
                    setNotice("Website connected. Reload the page if needed.");
                  });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Link2 size={16} />
              Connect this website
            </button>
          </div>
        )}
        {notice && (
          <div className="alert success">
            <CheckCircle2 size={16} />
            {notice}
          </div>
        )}
        {Object.entries(state.sites).length ? (
          Object.entries(state.sites).map(([origin, grant]) => (
            <div className="connection" key={origin}>
              <Globe size={18} />
              <div>
                <strong>{origin}</strong>
                <small>
                  {state.wallets.find((w) => w.id === grant.walletId)?.name ??
                    "Wallet"}
                </small>
              </div>
              <button
                className="icon"
                aria-label={`Disconnect ${origin}`}
                onClick={() =>
                  run(async () => {
                    await call("revoke", { origin });
                  })
                }
              >
                <X size={17} />
              </button>
            </div>
          ))
        ) : (
          <div className="empty">
            <Globe size={30} />
            <h3>No websites connected.</h3>
            <p>Open a website, then choose “Connect this website” here.</p>
          </div>
        )}
      </>
    );
  } else if (page === "settings") {
    content = (
      <>
        <div className="page-title">
          <h1>
            Your wallet.
            <br />
            Your rules.
          </h1>
          <p>Local storage. Explicit permission.</p>
        </div>
        <WalletUpdates
          blocked={busy || !!request || state.requests.length > 0}
        />
        <div className="card settings-list">
          <button onClick={() => nav("backup")}>
            <ShieldCheck size={18} />
            <span>
              Encrypted backup
              <small>
                {wallet.backedUp ? "Backup saved" : "Backup needed"}
              </small>
            </span>
            <ArrowUpRight size={16} />
          </button>
          <button onClick={() => nav("sites")}>
            <Globe size={18} />
            <span>
              Connected websites
              <small>{Object.keys(state.sites).length} connections</small>
            </span>
            <ArrowUpRight size={16} />
          </button>
          <button onClick={() => nav("password")}>
            <LockKeyhole size={18} />
            <span>Change password</span>
            <ArrowUpRight size={16} />
          </button>
          <button onClick={() => nav("create")}>
            <Plus size={18} />
            <span>Create another wallet</span>
            <ArrowUpRight size={16} />
          </button>
          <button onClick={() => nav("restore")}>
            <Download size={18} />
            <span>Restore a wallet</span>
            <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="card details">
          <div>
            <span>Network</span>
            <strong>Requant testnet</strong>
          </div>
          <div>
            <span>Auto-lock</span>
            <strong>5 minutes idle</strong>
          </div>
          <div>
            <span>Signing</span>
            <strong>Local Ed25519</strong>
          </div>
        </div>
        <div className="note">
          <AlertCircle size={16} />
          <span>Early testnet release. Internal security review planned.</span>
        </div>
        <a
          className="text full"
          href="https://requant.network"
          target="_blank"
          rel="noreferrer"
        >
          requant.network <ExternalLink size={13} />
        </a>
      </>
    );
  } else if (page === "activity") {
    const events = snapshot?.events ?? [];
    content = (
      <>
        <div className="page-title">
          <h1>Your on-chain story.</h1>
          <p>Transfers and locally recorded broadcasts.</p>
        </div>
        {events.length === 0 && state.outbox.length === 0 ? (
          <div className="empty">
            <Activity size={35} />
            <h3>A clean start.</h3>
            <p>Your first Requant transaction will appear here.</p>
          </div>
        ) : (
          <div className="activity-list">
            {state.outbox
              .filter((b) => !events.some((e) => e.txid === b.txid))
              .map((b) => (
                <div className="activity-row" key={b.txid}>
                  <span className="tx-icon">
                    <ArrowUpRight size={17} />
                  </span>
                  <div>
                    <a href={explorer(b.txid)} target="_blank" rel="noreferrer">
                      {short(b.txid, 9, 8)}
                    </a>
                    <small>
                      {b.status === "unknown"
                        ? "Broadcast unknown"
                        : b.status === "rejected"
                          ? "Rejected"
                          : "Pending confirmation"}
                    </small>
                  </div>
                  {b.status === "unknown" && (
                    <button
                      className="icon"
                      aria-label="Check broadcast"
                      onClick={() =>
                        run(async () => {
                          await call("checkBroadcast", { txid: b.txid });
                        })
                      }
                    >
                      <RefreshCw size={16} />
                    </button>
                  )}
                </div>
              ))}
            {events.map((e) => (
              <a
                className="activity-row"
                href={explorer(e.txid)}
                target="_blank"
                rel="noreferrer"
                key={e.txid}
              >
                <span className="tx-icon">
                  {BigInt(e.received) > BigInt(e.sent) ? (
                    <ArrowDownLeft size={17} />
                  ) : (
                    <ArrowUpRight size={17} />
                  )}
                </span>
                <div>
                  <strong>
                    {BigInt(e.received) > BigInt(e.sent) ? "Received" : "Sent"}
                  </strong>
                  <small>
                    {e.confirmations === "0"
                      ? "Pending"
                      : `${e.confirmations} confirmations`}
                  </small>
                </div>
                <span className="mono">
                  {rqt(BigInt(e.received) - BigInt(e.sent))}
                  <small>RQT</small>
                </span>
              </a>
            ))}
          </div>
        )}
        <button
          className="secondary full"
          disabled={busy}
          onClick={() => run(loadSnapshot)}
        >
          <RefreshCw size={15} />
          Refresh activity
        </button>
      </>
    );
  } else {
    content = (
      <>
        <div className="balance-card">
          <div className="eyebrow">
            SPENDABLE BALANCE <WalletIcon size={13} />
          </div>
          <div
            className={`balance ${snapshot?.spendable.length && snapshot.spendable.length > 15 ? "compact" : ""}`}
          >
            {money(snapshot?.spendable)}
            <span>RQT</span>
          </div>
          <div className="balance-caption">
            {snapshot
              ? "Confirmed and ready to move"
              : "Checking the testnet node…"}
          </div>
          <div className="balance-actions">
            <button onClick={() => nav("send")}>
              <ArrowUpRight size={19} />
              Send
            </button>
            <button onClick={() => nav("receive")}>
              <ArrowDownLeft size={19} />
              Receive
            </button>
            <button onClick={() => nav("sites")}>
              <Globe size={19} />
              Connect
            </button>
          </div>
        </div>
        <div className="address-line">
          <span className="mono">{short(wallet.address, 13, 10)}</span>
          <button
            className="icon tiny"
            aria-label="Copy wallet address"
            onClick={() => run(() => copy(wallet.address))}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
        {!wallet.backedUp && (
          <button className="backup-banner" onClick={() => nav("backup")}>
            <ShieldCheck size={20} />
            <span>
              Keep a way back.<small>Save your encrypted wallet backup.</small>
            </span>
            <ArrowUpRight size={16} />
          </button>
        )}
        <div className="balance-grid">
          <div>
            <span>Pending</span>
            <strong>
              {money(snapshot?.pending)}
              <small>RQT</small>
            </strong>
          </div>
          <div>
            <span>Maturing</span>
            <strong>
              {money(snapshot?.maturing)}
              <small>RQT</small>
            </strong>
          </div>
        </div>
        <div className="section-row">
          <h2>Activity</h2>
          <button className="text" onClick={() => nav("activity")}>
            View all
            <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="card empty small">
          <span className="empty-icon">
            <Activity size={22} />
          </span>
          <h3>
            {snapshot?.events.length
              ? "Your latest transfer"
              : "Ready for your first move."}
          </h3>
          <p>
            {snapshot?.events.length ? (
              <a
                href={explorer(snapshot.events[0].txid)}
                target="_blank"
                rel="noreferrer"
              >
                {short(snapshot.events[0].txid, 14, 12)}
              </a>
            ) : (
              "Receive test RQT to get started."
            )}
          </p>
          <button className="text" onClick={() => nav("receive")}>
            Get your address
            <ArrowDownLeft size={14} />
          </button>
        </div>
      </>
    );
  }
  const tabs = [
    ["home", "Wallet", WalletIcon],
    ["activity", "Activity", Activity],
    ["receive", "Receive", ArrowDownLeft],
    ["settings", "Settings", Settings],
  ] as const;
  return (
    <div className="shell">
      {preview && (
        <div className="preview-banner">DESIGN PREVIEW • UNFUNDED FIXTURE</div>
      )}
      <header>
        <div className="brand">
          <img src="/requant-mark.svg" alt="" />
          <span>
            requant<small>wallet</small>
          </span>
        </div>
        <div className="header-right">
          <span className="badge">
            <i />
            Testnet
          </span>
          {wallet && state.unlocked && (
            <button
              className="icon"
              aria-label="Lock wallet"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await call("lock");
                  nav("home");
                })
              }
            >
              <LockKeyhole size={17} />
            </button>
          )}
        </div>
      </header>
      {wallet && (
        <div className="wallet-bar">
          <select
            aria-label="Selected wallet"
            value={state.selected ?? ""}
            disabled={!!request || busy}
            onChange={(e) =>
              run(async () => {
                await call("select", { id: e.target.value });
                nav("home");
              })
            }
          >
            {state.wallets.map((w) => (
              <option value={w.id} key={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button
            className={`node-status ${nodeError ? "offline" : snapshot ? "online" : ""}`}
            disabled={!state.unlocked || busy}
            title={nodeError || "Refresh node connection"}
            onClick={() => run(loadSnapshot)}
          >
            <i />
            {nodeError ? "Offline" : snapshot ? "Connected" : "Connecting"}
          </button>
        </div>
      )}
      <main>
        {!requestParam && (
          <a
            className="primary full"
            href="full.html"
            target="_blank"
            rel="noreferrer"
          >
            Open full wallet · Swaps, channels & advanced tools
          </a>
        )}
        {page !== "settings" && (
          <WalletUpdates
            compact
            blocked={
              busy ||
              !!request ||
              state.requests.length > 0 ||
              !["home", "activity", "receive"].includes(page)
            }
          />
        )}
        {errorBox}
        {content}
        {nodeError && state.unlocked && (
          <div className="alert error">
            <AlertCircle size={16} />
            <span>
              {nodeError}
              {snapshot &&
                ` Last checked ${new Date(snapshot.observedAt).toLocaleTimeString("en-US")}.`}
            </span>
          </div>
        )}
        {state.requests.length > 0 && !requestParam && (
          <div className="requests">
            <span className="eyebrow">WEBSITE REQUESTS</span>
            {state.requests.map((r) => (
              <a
                key={r.id}
                href={`popup.html?request=${r.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <Globe size={15} />
                <span>
                  {r.origin}
                  <small>
                    {r.type === "connect"
                      ? "Connection request"
                      : "Transfer request"}
                  </small>
                </span>
                <ArrowUpRight size={15} />
              </a>
            ))}
          </div>
        )}
      </main>
      {wallet && state.unlocked && !requestParam && (
        <nav>
          {tabs.map(([id, label, Icon]) => (
            <button
              aria-current={page === id ? "page" : undefined}
              className={page === id ? "active" : ""}
              key={id}
              onClick={() => nav(id)}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
      )}
      {footer}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
