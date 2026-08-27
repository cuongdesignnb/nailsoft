/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { authorizedFetch } from "./auth";
import { legacyActionLabel, legacyColumnLabel, legacyText, legacyValue } from "./legacy-workspace-ui";

type State="loading"|"ready"|"empty"|"error"|"forbidden";
type Config={title:string;endpoint:string;create?:string;actions?:string[];hint:string};
const tenant:Record<string,Config>={
  "/admin/billing":{title:"Platform billing",endpoint:"/v1/tenant/billing/subscription",hint:"Plan, access status and renewal at a glance"},
  "/admin/billing/subscription":{title:"Subscription",endpoint:"/v1/tenant/billing/subscription",actions:["change-plan","cancel","reactivate"],hint:"Versioned lifecycle; downgrade preserves salon data"},
  "/admin/billing/plans":{title:"Plans",endpoint:"/v1/tenant/billing/plans",hint:"Published plans and test prices"},
  "/admin/billing/usage":{title:"Usage & quotas",endpoint:"/v1/tenant/billing/usage",hint:"Authoritative metered usage and quota evidence"},
  "/admin/billing/invoices":{title:"Platform invoices",endpoint:"/v1/tenant/billing/invoices",actions:["pay"],hint:"Separate from salon POS invoices"},
  "/admin/billing/payment-methods":{title:"Payment methods",endpoint:"/v1/tenant/billing/payment-methods",create:"/v1/tenant/billing/payment-methods",hint:"Token references only; no raw card data"},
  "/admin/billing/history":{title:"Billing history",endpoint:"/v1/tenant/billing/invoices",hint:"Immutable invoice and collection trail"},
  "/admin/support-access":{title:"Support access",endpoint:"/v1/tenant/support-access-grants",actions:["approve","deny","revoke"],hint:"Tenant-visible, scoped and time-limited support grants"},
};
const platform:Record<string,Config>={
  "/platform/plans":{title:"Plan catalog",endpoint:"/v1/platform/plans",create:"/v1/platform/plans",hint:"Draft, publish, supersede and retire immutable versions"},
  "/platform/prices":{title:"Price catalog",endpoint:"/v1/platform/prices",create:"/v1/platform/prices",actions:["activate"],hint:"Integer minor-unit prices and explicit intervals"},
  "/platform/discounts":{title:"Discounts",endpoint:"/v1/platform/plans",hint:"Evidence-backed discount foundation"},
  "/platform/tenants":{title:"Tenant lifecycle",endpoint:"/v1/platform/tenants",hint:"Billing state without salon operational data"},
  "/platform/invoices":{title:"Invoice operations",endpoint:"/v1/platform/invoices",create:"/v1/platform/invoices",actions:["calculate","finalize","void"],hint:"Finalized invoices and lines are immutable"},
  "/platform/payments":{title:"Payment operations",endpoint:"/v1/platform/payment-intents",create:"/v1/platform/payment-intents",actions:["confirm","reconcile"],hint:"Stable provider key and UNKNOWN-first reconciliation"},
  "/platform/refunds":{title:"Refund operations",endpoint:"/v1/platform/payment-intents",hint:"Refund cap and independent approval evidence"},
  "/platform/reconciliation":{title:"Reconciliation",endpoint:"/v1/platform/payment-intents",actions:["reconcile"],hint:"Resolve UNKNOWN before another provider attempt"},
  "/platform/dunning":{title:"Dunning",endpoint:"/v1/platform/invoices",hint:"Transactional email stages and access-mode transition"},
  "/platform/support-access":{title:"Support grants",endpoint:"/v1/platform/support-access-grants",create:"/v1/platform/support-access-grants",actions:["start-session"],hint:"No salon data access without active scoped grant"},
  "/platform/break-glass":{title:"Break glass",endpoint:"/v1/platform/support-access-grants",hint:"Disabled by default; dual approval required"},
  "/platform/reports":{title:"Platform reports",endpoint:"/v1/platform/tenants",hint:"SaaS-only data; excludes salon POS and payroll"},
};
const nav=["/admin/billing","/admin/billing/usage","/admin/billing/invoices","/admin/support-access"];
async function api(path:string,init?:RequestInit){const response=await authorizedFetch(path,init),body=await response.json().catch(()=>({}));if([401,403].includes(response.status))throw Object.assign(new Error("Permission denied"),{forbidden:true});if(!response.ok)throw new Error(`${body.error?.code??"REQUEST_FAILED"}: ${body.error?.message??"Retry safely"}`);return body.data;}
async function command(path:string,body:any){if(!navigator.onLine)throw new Error("Internet connection required. Billing writes are not queued offline.");return api(path,{method:"POST",headers:{"content-type":"application/json","idempotency-key":crypto.randomUUID()},body:JSON.stringify(body)});}

export default function Sprint13Screen(){const pathname=usePathname(),tenantDetail=pathname.match(/^\/platform\/tenants\/([^/]+)(?:\/(subscription|entitlements|usage|invoices|payments|lifecycle))?$/),invoiceDetail=pathname.match(/^\/admin\/billing\/invoices\/([^/]+)$/);let cfg:Config|undefined;if(tenantDetail){const id=tenantDetail[1],part=tenantDetail[2];cfg={title:`Tenant ${part??"overview"}`,endpoint:part==="usage"?`/v1/platform/tenants/${id}/usage/aggregates`:`/v1/platform/tenants/${id}`,hint:"Platform boundary view; salon appointments and payroll remain opaque"};}else if(invoiceDetail)cfg={title:"Invoice detail",endpoint:`/v1/tenant/billing/invoices/${invoiceDetail[1]}`,actions:["pay"],hint:"Immutable finalized platform invoice"};else cfg=Object.entries({...tenant,...platform}).sort((a,b)=>b[0].length-a[0].length).find(([path])=>pathname===path)?.[1];return <Workspace config={cfg??tenant["/admin/billing"]!} pathname={pathname}/>;}

function Workspace({config,pathname}:{config:Config;pathname:string}){const[state,setState]=useState<State>("loading"),[rows,setRows]=useState<any[]>([]),[error,setError]=useState(""),[notice,setNotice]=useState(""),endpoint=config.endpoint;
  const load=useCallback(async()=>{setState("loading");setError("");try{const value=await api(endpoint),list=Array.isArray(value)?value:value?[value]:[];setRows(list);setState(list.length?"ready":"empty");}catch(e:any){setError(e.message);setState(e.forbidden?"forbidden":"error");}},[endpoint]);useEffect(()=>void load(),[load]);
  const columns=useMemo(()=>Array.from(new Set(rows.flatMap(row=>Object.keys(row)))).filter(x=>!["evidenceJson","snapshotJson","permissionScopeJson","dataClassificationScopeJson"].includes(x)).slice(0,9),[rows]);
  async function act(row:any,action:string){try{const base=pathname.startsWith("/admin/support-access")?"/v1/tenant/support-access-grants":pathname.startsWith("/platform/support-access")?"/v1/platform/support-access-grants":pathname.startsWith("/platform/prices")?"/v1/platform/prices":pathname.startsWith("/platform/invoices")?"/v1/platform/invoices":pathname.startsWith("/platform/payments")||pathname.startsWith("/platform/reconciliation")?"/v1/platform/payment-intents":"/v1/tenant/billing/invoices";await command(`${base}/${row.id}/${action}`,{tenantId:row.tenantId,version:row.version,reason:"Reviewed in Sprint 13 functional workspace",observedStatus:"SUCCEEDED"});setNotice(`${action} completed.`);await load();}catch(e:any){setError(e.message);setState(e.forbidden?"forbidden":"error");}}
  return <main className="shell ops-shell"><nav className="topbar">{(pathname.startsWith("/platform")?Object.keys(platform).slice(0,6):nav).map(href=><a key={href} href={href}>{legacyText((platform[href]??tenant[href])?.title ?? href)}</a>)}</nav><section className="card"><p className="eyebrow">NAILSOFT · NỀN TẢNG & THANH TOÁN</p><div className="title-row"><div><h1>{legacyText(config.title)}</h1><p>{legacyText(config.hint)}</p></div><button onClick={()=>void load()}>Làm mới</button></div>{notice&&<p role="status">{notice}</p>}{state==="loading"&&<p aria-busy="true">Đang tải dữ liệu từ máy chủ…</p>}{state==="forbidden"&&<p role="alert">Không có quyền truy cập. Quyền nền tảng không đồng nghĩa với quyền xem dữ liệu salon.</p>}{state==="error"&&<div role="alert"><p>{error}</p><button onClick={()=>void load()}>Thử lại</button></div>}{state==="empty"&&<p>Chưa có bản ghi trong phạm vi được cấp quyền.</p>}{state==="ready"&&<div className="table-wrap"><table><thead><tr>{columns.map(c=><th key={c} scope="col">{legacyColumnLabel(c)}</th>)}{config.actions&&<th scope="col">Thao tác</th>}</tr></thead><tbody>{rows.map((row,index)=><tr key={row.id??index}>{columns.map(c=><td key={c} data-label={legacyColumnLabel(c)}>{legacyValue(row[c],c)}</td>)}{config.actions&&<td>{config.actions.map(action=><button key={action} onClick={()=>void act(row,action)}>{legacyActionLabel(action)}</button>)}</td>}</tr>)}</tbody></table></div>}{config.create&&<p className="hint">Mẫu lệnh nâng cao được quản lý bởi API theo từng loại bản ghi; không nhập JSON thô trong màn hình vận hành.</p>}</section><aside className="card"><h2>Ranh giới dữ liệu</h2><p>Thanh toán SaaS tách biệt với POS salon, Stored Value, Loyalty và Payroll. Số tiền dùng đơn vị minor nguyên.</p></aside></main>;
}
