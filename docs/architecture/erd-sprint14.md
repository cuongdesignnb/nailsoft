# Sprint 14 accounting ERD

`accounting_books` owns fiscal years, periods, chart of accounts, posting rules, journals and bank/reconciliation data. Every child carries `tenant_id`; composite scope guards in migration 0029 validate tenant/book relationships before insert or update. Posted journals are the immutable ledger source; statements and aging are derived.

```text
Book -> FiscalYear -> Period -> Journal -> JournalLine -> Account
Book -> PostingRule -> PostingRuleVersion -> PostingCandidate
Book -> BankAccount -> StatementImport -> StatementLine
BankAccount -> Reconciliation -> Match -> MatchAllocation -> StatementLine
Book -> OpeningBalanceImport -> OpeningBalanceRow -> Journal
Book -> StatementDefinition -> StatementSnapshot -> SnapshotLine
Book -> SourceAdapterMapping -> PostingCandidate -> SourcePostingHistory
BankAccount -> ReconciliationHistory
```
