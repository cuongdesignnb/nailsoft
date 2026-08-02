"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { authorizedFetch } from "./auth";

const views: Record<string,{title:string,endpoint:string}> = {
  "/admin/assets": { title:"Fixed asset register", endpoint:"/v1/assets" },
  "/admin/assets/candidates": { title:"Asset candidates", endpoint:"/v1/assets/candidates" },
  "/admin/assets/capitalization": { title:"Capitalization approvals", endpoint:"/v1/assets/capitalization-requests" },
  "/admin/assets/depreciation": { title:"Depreciation runs", endpoint:"/v1/assets/depreciation-runs" },
  "/admin/assets/maintenance": { title:"Maintenance work orders", endpoint:"/v1/assets/maintenance-work-orders" },
  "/admin/assets/transfers": { title:"Asset transfers", endpoint:"/v1/assets/transfers" },
  "/admin/assets/counts": { title:"Asset counts", endpoint:"/v1/assets/count-sessions" },
  "/admin/assets/inspections": { title:"Inspections", endpoint:"/v1/assets/inspections" },
  "/admin/assets/impairments": { title:"Impairments", endpoint:"/v1/assets/impairments" },
  "/admin/assets/disposals": { title:"Disposals", endpoint:"/v1/assets/disposals" },
  "/admin/assets/reports": { title:"Asset reports", endpoint:"/v1/assets/reports/register" },
};
export default function Sprint16Screen(){
  const pathname=usePathname(); const view=views[pathname]??views["/admin/assets"]!; const [state,setState]=useState("loading"); const [rows,setRows]=useState<any[]>([]); const [error,setError]=useState("");
  const load=useCallback(async()=>{setState("loading");try{const r=await authorizedFetch(view.endpoint);const b=await r.json();if(r.status===403)throw new Error("Permission denied for this asset scope.");if(!r.ok)throw new Error(b.error?.message??"Unable to load asset data.");const x=Array.isArray(b.data)?b.data:b.data?[b.data]:[];setRows(x);setState(x.length?"ready":"empty");}catch(e:any){setError(e.message);setState(e.message.includes("Permission")?"forbidden":"error");}},[view.endpoint]);
  useEffect(()=>{void load();},[load]); const columns=Array.from(new Set(rows.flatMap(r=>Object.keys(r)))).filter(k=>!k.toLowerCase().includes("json")).slice(0,8);
  return <main className="shell ops-shell"><nav className="topbar">{Object.entries(views).map(([href,item])=><a key={href} href={href}>{item.title}</a>)}</nav><section className="card"><p className="eyebrow">SPRINT 16 · FIXED ASSETS</p><div className="title-row"><div><h1>{view.title}</h1><p>Tenant/branch-scoped register with approval, evidence and immutable economics.</p></div><button onClick={()=>void load()}>Refresh</button></div>{state==="loading"&&<p aria-busy="true">Loading asset data…</p>}{state==="forbidden"&&<p role="alert">Permission denied for this branch or role.</p>}{state==="error"&&<div role="alert"><p>{error}</p><button onClick={()=>void load()}>Retry</button></div>}{state==="empty"&&<div><p>No records yet.</p><button onClick={()=>void load()}>Retry</button></div>}{state==="ready"&&<div className="table-wrap"><table><thead><tr>{columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={row.id??i}>{columns.map(c=><td key={c}>{typeof row[c]==="object"?JSON.stringify(row[c]):String(row[c]??"—")}</td>)}</tr>)}</tbody></table></div>}</section><aside className="card"><h2>Controls</h2><p>Commands use explicit transitions, idempotency keys, optimistic refresh and audit/outbox evidence. Posted economics cannot be edited.</p></aside></main>;
}
