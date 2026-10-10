# Website provider

The user first enables a site through the wallet's **Connect** screen. The extension
injects the provider into the top-level document of that HTTPS origin only.
Account access is origin-bound and can be revoked. Subframes cannot request approval.

```js
if (!window.requant?.isRequant) {
  // Ask the user to open Requant Wallet and connect this website.
}
const network = await window.requant.request({ method: "requant_getNetwork" });
// { network: 'testnet', chain: 'requant', version: 1 }
const accounts = await window.requant.request({
  method: "requant_requestAccounts",
});
const current = await window.requant.request({ method: "requant_accounts" });
// [] when disconnected or locked; otherwise [publicTestnetAddress]
```

Transfer request:

```js
const result = await window.requant.request({
  method: "requant_sendTransaction",
  params: {
    recipient: "trq1…", // complete checksummed Requant testnet address
    amount: "1.00000000", // decimal STRING, up to 8 decimal places
    fee: "0.00010000", // decimal STRING; optional, default 0.0001 RQT
  },
});
// { txid, status: 'pending' | 'rejected' | 'unknown', message }
```

For HD wallets, `fee` is a maximum: the wallet estimates the network fee and rejects a payment above that limit. Legacy single-key wallets retain the original fixed-fee behavior.

The wallet displays the browser-supplied origin, exact recipient, amount, actual fee,
total and source wallet. It uses the submitted request unchanged and requires a
password before signing. Reviews expire after two minutes; approval requests expire
after five minutes. A request is invalidated when its top-level browser document
changes. An unknown broadcast result must be checked before creating another transfer.
Do not retry transaction requests automatically.

Errors have a numeric `code`: `4001` rejected/expired, `4100` unauthorized or locked,
`4200` unsupported method, `-32602` invalid parameters, `-32002` another pending
approval, or `-32603` internal failure.

The provider offers request/response methods only in this version. Poll
`requant_accounts` when needed; account-change subscription events are not implemented.
There is no Ethereum, personal-message signing, token approval or arbitrary RPC proxy.
Keep `window.ethereum` integrations separate. Never ask a user for a wallet password
on a website.
