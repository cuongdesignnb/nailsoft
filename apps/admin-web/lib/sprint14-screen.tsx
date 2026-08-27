/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { authorizedFetch } from "./auth";
import { legacyActionLabel, legacyColumnLabel, legacyText, legacyValue } from "./legacy-workspace-ui";

type State="loading"|"ready"|"empty"|"error"|"forbidden";
type View={title:string; endpoint:string; hint:string; actions?:string[]};
const views:Record<string,View>={
  "/admin/accounting":{title:"Accounting control center",endpoint:"/v1/accounting/books",hint:"Post only balanced, tenant-scoped journals in an open period."},
  "/admin/accounting/books":{title:"Accounting books",endpoint:"/v1/accounting/books",hint:"Book activation is blocked until periods, accounts and checklist readiness are complete."},
  "/admin/accounting/periods":{title:"Accounting periods",endpoint:"/v1/accounting/periods",hint:"Close and reopen use separate, evidence-backed commands."},
  "/admin/accounting/journals":{title:"Journal workbench",endpoint:"/v1/accounting/journals",hint:"Submit, approve, post and reverse through explicit commands." ,actions:["submit","approve","post","request-reversal"]},
  "/admin/accounting/posting-candidates":{title:"Posting queue",endpoint:"/v1/accounting/posting-candidates",hint:"Source events are mapped and leased by the worker before posting."},
  "/admin/accounting/reports":{title:"Financial reports",endpoint:"/v1/accounting/reports",hint:"Reports read posted journals only; choose a book before querying."},
  "/admin/accounting/open-items":{title:"Open items",endpoint:"/v1/accounting/open-items",hint:"Settlement requires a posted journal in the same book and currency."},
  "/admin/accounting/reconciliation":{title:"Bank reconciliation",endpoint:"/v1/accounting/bank-accounts",hint:"Statement imports and reconciliation remain append-only evidence."},
};
async function read(path:string){const res=await authorizedFetch(path);const body=await res.json().catch(()=>({}));if(res.status===401||res.status===403)throw Object.assign(new Error("Permission denied"),{forbidden:true});if(!res.ok)throw new Error(body.error?.message??"Request failed");return body.data;}
export default function Sprint14Screen(){const pathname=usePathname();const view=views[pathname]??views["/admin/accounting"]!;const [state,setState]=useState<State>("loading"),[rows,setRows]=useState<any[]>([]),[error,setError]=useState("");const load=useCallback(async()=>{setState("loading");setError("");try{const value=await read(view.endpoint);const list=Array.isArray(value)?value:value?[value]:[];setRows(list);setState(list.length?"ready":"empty");}catch(e:any){setError(e.message);setState(e.forbidden?"forbidden":"error");}},[view.endpoint]);useEffect(()=>void load(),[load]);const cols=useMemo(()=>Array.from(new Set(rows.flatMap(r=>Object.keys(r)))).filter(k=>!k.toLowerCase().includes("json")).slice(0,8),[rows]);
  return <main className="shell ops-shell"><nav className="topbar">{Object.entries(views).map(([href,v])=><a key={href} href={href}>{legacyText(v.title)}</a>)}</nav><section className="card"><p className="eyebrow">NAILSOFT · SỔ KẾ TOÁN</p><div className="title-row"><div><h1>{legacyText(view.title)}</h1><p>{legacyText(view.hint)}</p></div><button onClick={()=>void load()}>Làm mới</button></div>{state==="loading"&&<p aria-busy="true">Đang tải dữ liệu kế toán từ máy chủ…</p>}{state==="forbidden"&&<p role="alert">Không có quyền truy cập phạm vi kế toán này.</p>}{state==="error"&&<div role="alert"><p>{error}</p><button onClick={()=>void load()}>Thử lại</button></div>}{state==="empty"&&<p>Chưa có bản ghi trong phạm vi được cấp quyền.</p>}{state==="ready"&&<div className="table-wrap"><table><thead><tr>{cols.map(c=><th key={c} scope="col">{legacyColumnLabel(c)}</th>)}{view.actions&&<th scope="col">Thao tác</th>}</tr></thead><tbody>{rows.map((row,i)=><tr key={row.id??i}>{cols.map(c=><td key={c} data-label={legacyColumnLabel(c)}>{legacyValue(row[c],c)}</td>)}{view.actions&&<td>{view.actions.map(action=><button key={action} onClick={()=>setError(`${legacyActionLabel(action)} cần bản ghi được chọn và xác nhận rõ ràng.`)}>{legacyActionLabel(action)}</button>)}</td>}</tr>)}</tbody></table></div>}</section><aside className="card"><h2>Kiểm soát kế toán</h2><p>Bút toán bất biến sau khi ghi sổ, việc đóng kỳ cần kiểm soát kép và PostgreSQL là nguồn dữ liệu chính thức.</p></aside></main>;
}
