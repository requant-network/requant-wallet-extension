export type Wallet = {
  id: string;
  name: string;
  address: string;
  owner: string;
  publicKey: string;
  backedUp: boolean;
};
export type SiteRequest = {
  id: string;
  origin: string;
  type: "connect" | "send";
  params?: { recipient: string; amount: string; fee: string };
  created: number;
  walletId?: string;
};
export type Broadcast = { txid: string; status: string; created: number };
export type State = {
  wallets: Wallet[];
  selected: string | null;
  unlocked: boolean;
  sites: Record<string, { walletId: string }>;
  outbox: Broadcast[];
  requests: SiteRequest[];
};
export type Snapshot = {
  confirmed: string;
  pending: string;
  maturing: string;
  spendable: string;
  observedAt: number;
  info: { height: string; peers: string; tip: string };
  events: {
    txid: string;
    received: string;
    sent: string;
    confirmations: string;
    height: string | null;
    time: string | null;
  }[];
};
export type Review = {
  id: string;
  recipient: string;
  amount: string;
  fee: string;
  total: string;
  address: string;
  walletName: string;
};
