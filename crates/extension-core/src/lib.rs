mod crypto;
mod transfer;

use crypto::Result;
use ed25519_dalek::SigningKey;
use requant_consensus::{
    address::{address, parse_address},
    params::{Network, MAX_AMOUNT},
    tx::{pkh, Tx},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use transfer::Coin;
use wasm_bindgen::prelude::*;
use zeroize::Zeroizing;

fn field<'a>(v: &'a Value, name: &str) -> Result<&'a str> {
    v.get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing {name}."))
}
fn rpc(raw: &str) -> Result<Value> {
    if raw.len() > 4 * 1024 * 1024 {
        return Err("Node response is too large.".into());
    }
    let v: Value = serde_json::from_str(raw).map_err(|_| "Invalid node response.")?;
    if !v.get("error").is_some_and(Value::is_null) {
        return Err("The node rejected this request.".into());
    }
    v.get("result")
        .cloned()
        .ok_or("Invalid node response.".into())
}
fn strings(v: Value) -> Value {
    match v {
        Value::Number(n) => Value::String(n.to_string()),
        Value::Array(a) => Value::Array(a.into_iter().map(strings).collect()),
        Value::Object(o) => Value::Object(o.into_iter().map(|(k, v)| (k, strings(v))).collect()),
        other => other,
    }
}
fn meta(secret: &[u8; 32]) -> Value {
    let pubkey = SigningKey::from_bytes(secret).verifying_key().to_bytes();
    let owner = pkh(&pubkey);
    json!({"address":address(&Network::test(), &owner),"owner":hex::encode(owner),"publicKey":hex::encode(pubkey)})
}
fn coins(raw: &str) -> Result<Vec<Coin>> {
    let c: Vec<Coin> =
        serde_json::from_value(rpc(raw)?).map_err(|_| "Invalid node output list.")?;
    transfer::validate_coins(&c)?;
    Ok(c)
}
fn info(raw: &str, genesis: &str) -> Result<Value> {
    let v = rpc(raw)?;
    let tip = v["tip"].as_str().unwrap_or_default();
    if v["network"] != "test"
        || hex::decode(tip).map_or(true, |b| b.len() != 32)
        || v["height"].as_u64().is_none()
        || v["peers"].as_u64().is_none()
    {
        return Err("This wallet requires a valid Requant testnet node.".into());
    }
    let net = Network::test();
    let expected = hex::encode(requant_consensus::block::genesis(&net).id(&net));
    if rpc(genesis)?["id"] != expected {
        return Err("The node genesis does not match Requant testnet.".into());
    }
    Ok(strings(v))
}

#[derive(Clone, Deserialize, Serialize)]
struct Plan {
    recipient: String,
    value: u64,
    fee: u64,
    coins: Vec<Coin>,
}
fn parents(plan: &Plan, owner: &str, values: &Value) -> Result<()> {
    if plan.coins.len() > 64 {
        return Err("Use a smaller amount: this transfer exceeds 64 inputs.".into());
    }
    for c in &plan.coins {
        let encoded = values
            .get(&c.txid)
            .and_then(Value::as_str)
            .ok_or("Missing source transaction.")?;
        let source = rpc(encoded)?;
        let raw = hex::decode(
            source["hex"]
                .as_str()
                .ok_or("Missing source transaction bytes.")?,
        )
        .map_err(|_| "Invalid source transaction bytes.")?;
        let tx = Tx::decode_exact(&raw).map_err(|_| "Invalid source transaction.")?;
        tx.check_standalone(&Network::test().chain_id)
            .map_err(|_| "Invalid source transaction signature or amounts.")?;
        if hex::encode(tx.txid()) != c.txid {
            return Err("Source transaction hash mismatch.".into());
        }
        let out = tx
            .outputs()
            .get(c.vout as usize)
            .ok_or("Missing source output.")?;
        if out.value != c.value || hex::encode(out.pkh) != owner {
            return Err("Source output value or owner mismatch.".into());
        }
    }
    Ok(())
}
pub fn execute(op: &str, input: &str) -> Result<String> {
    if input.len() > 16 * 1024 * 1024 {
        return Err("Request is too large.".into());
    }
    let v: Value = serde_json::from_str(input).map_err(|_| "Invalid wallet request.")?;
    let out = match op {
        "create" => {
            let password = Zeroizing::new(field(&v, "password")?.to_owned());
            crypto::new_password(&password)?;
            let secret = Zeroizing::new(crypto::random::<32>()?);
            json!({"meta":meta(&secret),"encrypted":crypto::encrypt(&secret,&password)?})
        }
        "restore" | "unlock" | "changePassword" => {
            let password = Zeroizing::new(field(&v, "password")?.to_owned());
            let encrypted = field(&v, "encrypted")?.trim();
            let secret = crypto::decrypt(encrypted, &password, false)?;
            let mut out = json!({"meta":meta(&secret)});
            if op == "restore" {
                out["encrypted"] = json!(encrypted);
            }
            if op == "changePassword" {
                let next = Zeroizing::new(field(&v, "nextPassword")?.to_owned());
                crypto::new_password(&next)?;
                out["encrypted"] = json!(crypto::encrypt(&secret, &next)?);
            }
            out
        }
        "rpc" => strings(rpc(field(&v, "raw")?)?),
        "info" => info(field(&v, "raw")?, field(&v, "genesis")?)?,
        "snapshot" => {
            let outputs = coins(field(&v, "coinsRaw")?)?;
            let events = rpc(field(&v, "historyRaw")?)?;
            let events = events.as_array().ok_or("Invalid activity response.")?;
            if events.len() > 100 {
                return Err("Too many activity entries.".into());
            }
            for e in events {
                if e["received"].as_u64().is_none_or(|x| x > MAX_AMOUNT)
                    || e["sent"].as_u64().is_none_or(|x| x > MAX_AMOUNT)
                    || e["confirmations"].as_u64().is_none()
                    || hex::decode(e["txid"].as_str().unwrap_or_default())
                        .map_or(true, |b| b.len() != 32)
                {
                    return Err("Invalid activity amounts or transaction ID.".into());
                }
            }
            let sum = |filter: fn(&Coin) -> bool| -> String {
                transfer::amount(outputs.iter().filter(|c| filter(c)).map(|c| c.value).sum())
            };
            json!({"confirmed":sum(|c|c.confirmed&&c.spendable),"spendable":sum(|c|c.confirmed&&c.spendable),
                "pending":sum(|c|!c.confirmed),"maturing":sum(|c|!c.spendable),"events":strings(json!(events))})
        }
        "plan" => {
            let recipient = field(&v, "recipient")?;
            parse_address(&Network::test(), recipient)
                .map_err(|_| "Enter a complete Requant testnet address.")?;
            let value = transfer::parse_amount(field(&v, "amount")?)?;
            let fee = transfer::parse_amount(field(&v, "fee")?)?;
            let selected = transfer::select(&coins(field(&v, "coinsRaw")?)?, value, fee, false)?;
            if selected.len() > 64 {
                return Err("Use a smaller amount: this transfer exceeds 64 inputs.".into());
            }
            let plan = Plan {
                recipient: recipient.into(),
                value,
                fee,
                coins: selected,
            };
            json!({"sealed":serde_json::to_string(&plan).map_err(|_|"Cannot prepare transfer.")?,
                "review":{"recipient":recipient,"amount":transfer::amount(value),"fee":transfer::amount(fee),"total":transfer::amount(value+fee),
                "inputs":plan.coins.iter().map(|c|json!({"txid":c.txid,"vout":c.vout})).collect::<Vec<_>>()}})
        }
        "verifyParents" | "sign" => {
            let plan: Plan = serde_json::from_str(field(&v, "sealed")?)
                .map_err(|_| "Invalid transfer review.")?;
            transfer::validate_coins(&plan.coins)?;
            let owner = field(&v, "owner")?;
            parents(&plan, owner, &v["parents"])?;
            if op == "verifyParents" {
                json!(true)
            } else {
                let fresh = coins(field(&v, "freshRaw")?)?;
                for c in &plan.coins {
                    if !c.confirmed
                        || !c.spendable
                        || !fresh.iter().any(|n| {
                            n.txid == c.txid
                                && n.vout == c.vout
                                && n.value == c.value
                                && n.confirmed
                                && n.spendable
                        })
                    {
                        return Err(
                            "Selected funds changed or were spent. Review the transfer again."
                                .into(),
                        );
                    }
                }
                let password = Zeroizing::new(field(&v, "password")?.to_owned());
                let secret = crypto::decrypt(field(&v, "encrypted")?, &password, false)?;
                if meta(&secret)["owner"] != owner {
                    return Err("Wallet metadata does not match its encrypted key.".into());
                }
                let tx =
                    transfer::sign(&secret, &plan.coins, &plan.recipient, plan.value, plan.fee)?;
                json!({"txid":hex::encode(tx.txid()),"hex":hex::encode(tx.encode())})
            }
        }
        _ => return Err("Unsupported wallet operation.".into()),
    };
    serde_json::to_string(&out).map_err(|_| "Cannot encode wallet response.".into())
}
#[wasm_bindgen]
pub fn invoke(op: &str, input: &str) -> std::result::Result<String, JsValue> {
    execute(op, input).map_err(|e| JsValue::from_str(&e))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn call(op: &str, v: Value) -> Result<Value> {
        serde_json::from_str(&execute(op, &v.to_string())?).map_err(|e| e.to_string())
    }
    fn reply(v: Value) -> String {
        json!({"result":v,"error":null}).to_string()
    }
    #[test]
    fn backup_compatibility_and_password_change() {
        let pw = "test-only-no-funds-password";
        let encrypted = crypto::encrypt(&[7; 32], pw).unwrap();
        let restored = call("restore", json!({"encrypted":encrypted,"password":pw})).unwrap();
        assert_eq!(restored["meta"], meta(&[7; 32]));
        assert!(call(
            "unlock",
            json!({"encrypted":encrypted,"password":"incorrect"})
        )
        .is_err());
        assert!(call(
            "restore",
            json!({"encrypted":hex::encode([7;32]),"password":pw})
        )
        .is_err());
        let changed = call(
            "changePassword",
            json!({"encrypted":encrypted,"password":pw,"nextPassword":"second-test-only-password"}),
        )
        .unwrap();
        assert_eq!(
            *crypto::decrypt(
                changed["encrypted"].as_str().unwrap(),
                "second-test-only-password",
                false
            )
            .unwrap(),
            [7; 32]
        );
    }
    #[test]
    fn exact_uint64_and_chain_guard() {
        let parsed = call(
            "rpc",
            json!({"raw":reply(json!({"value":9007199254740993u64}))}),
        )
        .unwrap();
        assert_eq!(parsed["value"], "9007199254740993");
        let net = Network::test();
        let status =
            reply(json!({"network":"test","height":1,"tip":hex::encode([1;32]),"peers":2}));
        assert!(call(
            "info",
            json!({"raw":status,"genesis":reply(json!({"id":"wrong"}))})
        )
        .is_err());
        assert!(call("info",json!({"raw":status,"genesis":reply(json!({"id":hex::encode(requant_consensus::block::genesis(&net).id(&net))}))})).is_ok());
        assert_eq!(
            transfer::parse_amount("92233720368.54775808").unwrap(),
            MAX_AMOUNT
        );
        assert!(transfer::parse_amount("92233720368.54775809").is_err());
    }
    #[test]
    fn sign_checks_source_owner_value_unspent_and_domain() {
        let key = [7; 32];
        let owner = meta(&key)["owner"].as_str().unwrap().to_owned();
        let parent = Tx::Coinbase {
            height: 1,
            extra: vec![],
            outputs: vec![requant_consensus::tx::Output {
                value: 9007199254740993,
                pkh: pkh(&SigningKey::from_bytes(&key).verifying_key().to_bytes()),
            }],
        };
        let tid = hex::encode(parent.txid());
        let c = Coin {
            txid: tid.clone(),
            vout: 0,
            value: 9007199254740993,
            confirmed: true,
            spendable: true,
            coinbase: true,
            height: Some(1),
        };
        let recipient = meta(&[8; 32])["address"].as_str().unwrap().to_owned();
        let plan=call("plan",json!({"recipient":recipient,"amount":"90071992.54730992","fee":"0.0001","coinsRaw":reply(json!([c]))})).unwrap();
        let mut input = json!({"sealed":plan["sealed"],"owner":owner,"parents":{tid.clone():reply(json!({"hex":hex::encode(parent.encode())}))},"freshRaw":reply(json!([c])),"encrypted":crypto::encrypt(&key,"test-only-no-funds-password").unwrap(),"password":"test-only-no-funds-password"});
        let signed = call("sign", input.clone()).unwrap();
        let tx = Tx::decode_exact(&hex::decode(signed["hex"].as_str().unwrap()).unwrap()).unwrap();
        assert!(tx.check_standalone(&Network::test().chain_id).is_ok());
        assert!(tx.check_standalone(&Network::regtest().chain_id).is_err());
        input["freshRaw"] = json!(reply(json!([])));
        assert!(call("sign", input.clone()).is_err());
        input["freshRaw"] = json!(reply(json!([c])));
        input["owner"] = json!(hex::encode([0; 32]));
        assert!(call("sign", input).is_err());
        let mut falsecoin = c.clone();
        falsecoin.value += 1;
        let falseplan=call("plan",json!({"recipient":recipient,"amount":"1","fee":"0","coinsRaw":reply(json!([falsecoin]))})).unwrap();
        assert!(call("verifyParents",json!({"sealed":falseplan["sealed"],"owner":owner,"parents":{tid:reply(json!({"hex":hex::encode(parent.encode())}))}})).is_err());
    }
    /// A coin created by a kind-2 transfer (spending conditions and time locks, Requant node 0.15.0)
    /// is verified and spent like any other: the pinned consensus decodes and checks its source.
    #[test]
    fn signs_a_coin_whose_source_spent_a_condition_or_time_lock() {
        use requant_consensus::tx::{Htlc, Input, OutPoint, Unlock};
        let key = [7; 32];
        let owner = meta(&key)["owner"].as_str().unwrap().to_owned();
        let other = SigningKey::from_bytes(&[9; 32]);
        let htlc = Htlc {
            hash: [1; 32],
            claim: [2; 32],
            refund: pkh(&other.verifying_key().to_bytes()),
            timeout: 1500,
        };
        let mut parent = Tx::Transfer {
            inputs: vec![
                Input {
                    after_height: 1500,
                    unlock: Unlock::HtlcRefund { htlc },
                    ..Input::new(OutPoint {
                        txid: [3; 32],
                        vout: 0,
                    })
                },
                Input {
                    after_blocks: 10,
                    ..Input::new(OutPoint {
                        txid: [3; 32],
                        vout: 1,
                    })
                },
            ],
            outputs: vec![requant_consensus::tx::Output {
                value: 500_000_000,
                pkh: pkh(&SigningKey::from_bytes(&key).verifying_key().to_bytes()),
            }],
        };
        parent.sign(&Network::test().chain_id, &[&other, &other]);
        assert!(parent.is_v2());
        assert_eq!(parent.encode()[4], 2, "a kind-2 transfer");
        let tid = hex::encode(parent.txid());
        let c = Coin {
            txid: tid.clone(),
            vout: 0,
            value: 500_000_000,
            confirmed: true,
            spendable: true,
            coinbase: false,
            height: Some(1500),
        };
        let recipient = meta(&[8; 32])["address"].as_str().unwrap().to_owned();
        let plan = call(
            "plan",
            json!({"recipient":recipient,"amount":"1","fee":"0.0001","coinsRaw":reply(json!([c]))}),
        )
        .unwrap();
        let input = json!({"sealed":plan["sealed"],"owner":owner,"parents":{tid:reply(json!({"hex":hex::encode(parent.encode())}))},"freshRaw":reply(json!([c])),"encrypted":crypto::encrypt(&key,"test-only-no-funds-password").unwrap(),"password":"test-only-no-funds-password"});
        let signed = call("sign", input).unwrap();
        let tx = Tx::decode_exact(&hex::decode(signed["hex"].as_str().unwrap()).unwrap()).unwrap();
        assert!(tx.check_standalone(&Network::test().chain_id).is_ok());
    }
    #[test]
    fn emit_public_unfunded_integration_fixture() {
        let key = [7; 32];
        let metadata = meta(&key);
        let parent = Tx::Coinbase {
            height: 1,
            extra: vec![],
            outputs: vec![requant_consensus::tx::Output {
                value: 9007199254740993,
                pkh: pkh(&SigningKey::from_bytes(&key).verifying_key().to_bytes()),
            }],
        };
        let coin = Coin {
            txid: hex::encode(parent.txid()),
            vout: 0,
            value: 9007199254740993,
            confirmed: true,
            spendable: true,
            coinbase: true,
            height: Some(1),
        };
        let fixture = json!({"metadata":metadata,"recipient":meta(&[8;32])["address"],"encrypted":crypto::encrypt(&key,"test-only-no-funds-password").unwrap(),"parentHex":hex::encode(parent.encode()),"coin":coin,"genesis":hex::encode(requant_consensus::block::genesis(&Network::test()).id(&Network::test()))});
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("test-fixture.json"), fixture.to_string()).unwrap();
    }
}
