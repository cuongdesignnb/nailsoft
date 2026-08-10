export type OwnerWave8Screen = {
  id: `19.8.${number}`;
  key: string;
  titleKey: string;
  routeGroup: string[];
  scope: "TENANT_WIDE" | "BRANCH_FILTERABLE" | "BRANCH_REQUIRED" | "USER";
  readScreens: string[];
  mutationScreens: string[];
  offlineWrite: "DENIED";
};

/** The twelve logical screens are intentionally mapped to existing route groups. */
export const ownerWave8Screens: OwnerWave8Screen[] = [
  { id: "19.8.1", key: "OWNER_HOME_EXECUTIVE_OVERVIEW", titleKey: "executiveOverview", routeGroup: ["/"], scope: "TENANT_WIDE", readScreens: ["operationalSummary", "financialSummary", "analyticsAlerts"], mutationScreens: [], offlineWrite: "DENIED" },
  { id: "19.8.2", key: "TODAY_OPERATIONS", titleKey: "todayOperations", routeGroup: ["/operationalSummary", "/walkInQueue", "/appointmentsToday"], scope: "BRANCH_REQUIRED", readScreens: ["operationalSummary", "walkInQueue", "appointmentsToday"], mutationScreens: [], offlineWrite: "DENIED" },
  { id: "19.8.3", key: "BOOKINGS_CALENDAR_AVAILABILITY", titleKey: "bookings", routeGroup: ["/appointments", "/appointment", "/calendarDay", "/calendarWeek", "/availability", "/blocks"], scope: "BRANCH_REQUIRED", readScreens: ["appointments", "appointment", "calendarDay", "calendarWeek", "availability"], mutationScreens: ["appointment", "blocks"], offlineWrite: "DENIED" },
  { id: "19.8.4", key: "FEDERATED_APPROVAL_INBOX", titleKey: "approvals", routeGroup: ["/pendingRefunds", "/pendingLoyaltyAdjustments", "/campaignApprovals", "/compensationApprovals", "/timesheetApprovals", "/payrollApprovals", "/payoutApprovals", "/procurementRequests", "/procurementPayments", "/assetApprovals"], scope: "BRANCH_FILTERABLE", readScreens: ["pendingRefunds", "pendingLoyaltyAdjustments", "campaignApprovals", "compensationApprovals", "timesheetApprovals", "payrollApprovals", "payoutApprovals", "procurementRequests", "procurementPayments", "assetApprovals"], mutationScreens: ["pendingRefunds", "campaignApprovals", "compensationApprovals", "timesheetApprovals", "payrollApprovals", "payoutApprovals", "procurementRequests", "procurementPayments", "assetApprovals"], offlineWrite: "DENIED" },
  { id: "19.8.5", key: "FINANCIAL_OVERVIEW", titleKey: "finance", routeGroup: ["/financialSummary", "/refundTotals", "/commissionReadiness", "/benefitLiability", "/storedValueLiability", "/customerCreditOutstanding"], scope: "BRANCH_FILTERABLE", readScreens: ["financialSummary", "refundTotals", "commissionReadiness", "benefitLiability", "storedValueLiability", "customerCreditOutstanding"], mutationScreens: [], offlineWrite: "DENIED" },
  { id: "19.8.6", key: "WORKFORCE_PAYROLL", titleKey: "workforce", routeGroup: ["/attendanceSummary", "/missingPunchAlerts", "/timesheetApprovals", "/payrollApprovals", "/payoutApprovals", "/payrollFailures"], scope: "BRANCH_FILTERABLE", readScreens: ["attendanceSummary", "missingPunchAlerts", "timesheetApprovals", "payrollApprovals", "payoutApprovals", "payrollFailures"], mutationScreens: ["timesheetApprovals", "payrollApprovals", "payoutApprovals"], offlineWrite: "DENIED" },
  { id: "19.8.7", key: "INVENTORY_PROCUREMENT", titleKey: "inventoryProcurement", routeGroup: ["/inventoryLowStock", "/inventoryValuation", "/inventoryApprovals", "/procurementVendors", "/procurementRequests", "/procurementOrders", "/procurementBills", "/procurementAp", "/procurementPayments"], scope: "BRANCH_FILTERABLE", readScreens: ["inventoryLowStock", "inventoryValuation", "inventoryApprovals", "procurementVendors", "procurementRequests", "procurementOrders", "procurementBills", "procurementAp", "procurementPayments"], mutationScreens: ["inventoryApprovals", "procurementRequests", "procurementPayments"], offlineWrite: "DENIED" },
  { id: "19.8.8", key: "FIXED_ASSETS", titleKey: "assets", routeGroup: ["/assetSummary", "/assetApprovals", "/assetMaintenance", "/assetTransfers", "/assetDisposals"], scope: "BRANCH_FILTERABLE", readScreens: ["assetSummary", "assetApprovals", "assetMaintenance", "assetTransfers", "assetDisposals"], mutationScreens: ["assetApprovals"], offlineWrite: "DENIED" },
  { id: "19.8.9", key: "ANALYTICS_ALERTS", titleKey: "analytics", routeGroup: ["/analyticsOverview", "/analyticsBranches", "/analyticsAlerts", "/lowRatingAlerts", "/recoverySla"], scope: "BRANCH_FILTERABLE", readScreens: ["analyticsOverview", "analyticsBranches", "analyticsAlerts", "lowRatingAlerts", "recoverySla"], mutationScreens: [], offlineWrite: "DENIED" },
  { id: "19.8.10", key: "SAAS_BILLING", titleKey: "billing", routeGroup: ["/billingPlan", "/billingQuotas", "/billingInvoices", "/billingWarnings"], scope: "TENANT_WIDE", readScreens: ["billingPlan", "billingQuotas", "billingInvoices", "billingWarnings"], mutationScreens: [], offlineWrite: "DENIED" },
  { id: "19.8.11", key: "SUPPORT_ACCESS_SECURITY", titleKey: "security", routeGroup: ["/supportAccess", "/sessions", "/organization", "/branches", "/team", "/invitation"], scope: "TENANT_WIDE", readScreens: ["supportAccess", "sessions", "organization", "branches", "team", "invitation"], mutationScreens: ["supportAccess", "sessions", "invitation"], offlineWrite: "DENIED" },
  { id: "19.8.12", key: "PROFILE_AUTH_SETTINGS", titleKey: "profile", routeGroup: ["/profile", "/workspace", "/mfa"], scope: "USER", readScreens: ["profile", "workspace", "mfa"], mutationScreens: ["profile", "workspace", "mfa"], offlineWrite: "DENIED" },
];

export function ownerWave8Screen(id: string) {
  return ownerWave8Screens.find((screen) => screen.id === id || screen.key === id);
}
