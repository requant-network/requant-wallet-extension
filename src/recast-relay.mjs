import { connection } from "../web/src/recast.mjs";
export async function recastRelay({url,token,action,approval}, transport=fetch) {
 const source=connection(`${url}#${token}`);
 if(source.url!==url || !["read","approve","reject"].includes(action))throw new Error("Invalid ReCast relay request.");
 if(action==="approve" && (!approval || Object.keys(approval).length!==2 || !/^[a-f0-9]{64}$/.test(approval.public_key) || !/^[a-f0-9]{128}$/.test(approval.signature)))throw new Error("Invalid wallet approval fields.");
 if(action!=="approve" && approval!==undefined)throw new Error("Unexpected relay payload.");
 const response=await transport(url+(action==="read"?"":"/"+action),{method:action==="read"?"GET":"POST",headers:{Authorization:`Pairing ${token}`,...(action==="approve"?{"Content-Type":"application/json"}:{})},...(action==="approve"?{body:JSON.stringify(approval)}:{}),credentials:"omit",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",signal:AbortSignal.timeout(10000)});
 const text=await response.text();if(text.length>16384)throw new Error("ReCast response is too large.");
 let value;try{value=text?JSON.parse(text):{};}catch{throw new Error("Invalid ReCast response.");}
 if(!response.ok)throw new Error(value.error?.message??"ReCast request was rejected.");return value;
}
