import { expect, test } from "@playwright/test";
import { close, headers, login } from "./helpers/api-client";

test("accounting journal requires independent approval and posts an immutable number", async()=>{
  const accountant=await login("accountant@example.test"); const owner=await login("owner@example.test"); const suffix=Date.now().toString().slice(-6);
  try{
    const bookResponse=await accountant.api.post("/v1/accounting/books",{headers:headers(accountant,`s14-book-${suffix}`),data:{code:`E2E${suffix}`,name:"E2E Accounting",functionalCurrency:"VND",timezone:"Asia/Ho_Chi_Minh"}});expect(bookResponse.ok()).toBeTruthy();const book=(await bookResponse.json()).data;
    const cashResponse=await accountant.api.post("/v1/accounting/accounts",{headers:headers(accountant),data:{bookId:book.id,code:`1${suffix}`,name:"Cash",accountType:"ASSET",controlClass:"CASH"}});expect(cashResponse.ok()).toBeTruthy();const cash=(await cashResponse.json()).data;
    const revenueResponse=await accountant.api.post("/v1/accounting/accounts",{headers:headers(accountant),data:{bookId:book.id,code:`4${suffix}`,name:"Revenue",accountType:"REVENUE",controlClass:"SERVICE_REVENUE"}});expect(revenueResponse.ok()).toBeTruthy();const revenue=(await revenueResponse.json()).data;
    const periodResponse=await accountant.api.post("/v1/accounting/periods",{headers:headers(accountant),data:{bookId:book.id,code:`E2E-${suffix}`,startsOn:"2096-01-01",endsOn:"2096-01-31",yearNo:2096}});expect(periodResponse.ok()).toBeTruthy();const period=(await periodResponse.json()).data;
    const activated=await accountant.api.post(`/v1/accounting/books/${book.id}/activate`,{headers:headers(accountant),data:{postingMode:"REVIEW_REQUIRED"}});expect(activated.ok(),`book activation failed: ${JSON.stringify(await activated.json())}`).toBeTruthy();
    const open=await accountant.api.post(`/v1/accounting/periods/${period.id}/open`,{headers:headers(accountant),data:{}});expect(open.ok(),`period open failed: ${JSON.stringify(await open.json())}`).toBeTruthy();
    const journalResponse=await accountant.api.post("/v1/accounting/journals",{headers:headers(accountant,`s14-journal-${suffix}`),data:{bookId:book.id,periodId:period.id,journalType:"MANUAL",accountingDate:"2096-01-02",currency:"VND",lines:[{accountId:cash.id,debitMinor:1000,creditMinor:0},{accountId:revenue.id,debitMinor:0,creditMinor:1000}]}});expect(journalResponse.ok()).toBeTruthy();const journal=(await journalResponse.json()).data;
    const submitted=await accountant.api.post(`/v1/accounting/journals/${journal.id}/submit`,{headers:headers(accountant),data:{version:journal.version,reason:"E2E submit"}});expect(submitted.ok()).toBeTruthy();const pending=(await submitted.json()).data;
    const selfApprove=await accountant.api.post(`/v1/accounting/journals/${journal.id}/approve`,{headers:headers(accountant),data:{version:pending.version,reason:"self"}});expect(selfApprove.status()).toBe(403);
    const approved=await owner.api.post(`/v1/accounting/journals/${journal.id}/approve`,{headers:headers(owner),data:{version:pending.version,reason:"Independent owner approval"}});expect(approved.ok()).toBeTruthy();const approvedJournal=(await approved.json()).data;
    const posted=await owner.api.post(`/v1/accounting/journals/${journal.id}/post`,{headers:headers(owner),data:{version:approvedJournal.version,reason:"E2E post"}});expect(posted.ok()).toBeTruthy();expect((await posted.json()).data.journal_number).toBeTruthy();
  }finally{await close(accountant);await close(owner);}
});
