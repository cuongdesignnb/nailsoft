"use client";

import CustomerCreate from "./sprint19-wave3/customer-create";
import CustomerDetail from "./sprint19-wave3/customer-detail";
import CustomerDirectory from "./sprint19-wave3/customer-directory";
import BenefitsWallet from "./sprint19-wave3/benefits-wallet";
import LoyaltyPrograms, { CustomerLoyalty, LoyaltyAdjustments } from "./sprint19-wave3/loyalty";
import MembershipTiers, { CustomerMembership } from "./sprint19-wave3/membership";
import PackageCatalog, { PackageDetail, PackageEntitlements, PackageEntitlementDetail } from "./sprint19-wave3/packages";
import { isWave3CustomerPath, isWave3Path } from "./sprint19-wave3/routes";

export { isWave3CustomerPath, isWave3Path };

export default function Sprint19Wave3CustomerScreen({ pathname }: { pathname: string }) {
  if (pathname === "/admin/benefits" || pathname === "/admin/benefits/") return <BenefitsWallet />;
  const benefitCustomer = pathname.match(/^\/admin\/benefits\/customers\/([^/]+)$/);
  if (benefitCustomer) return <BenefitsWallet customerId={benefitCustomer[1] ?? ""} />;
  if (pathname === "/admin/loyalty/programs") return <LoyaltyPrograms />;
  if (pathname === "/admin/loyalty/adjustments") return <LoyaltyAdjustments />;
  const loyaltyCustomer = pathname.match(/^\/admin\/loyalty\/customers\/([^/]+)$/);
  if (loyaltyCustomer) return <CustomerLoyalty customerId={loyaltyCustomer[1] ?? ""} />;
  if (pathname === "/admin/membership/tiers") return <MembershipTiers />;
  const membershipCustomer = pathname.match(/^\/admin\/membership\/customers\/([^/]+)$/);
  if (membershipCustomer) return <CustomerMembership customerId={membershipCustomer[1] ?? ""} />;
  if (pathname === "/admin/packages/catalog") return <PackageCatalog />;
  const packageDetail = pathname.match(/^\/admin\/packages\/catalog\/([^/]+)$/);
  if (packageDetail) return <PackageDetail packageId={packageDetail[1] ?? ""} />;
  if (pathname === "/admin/packages/entitlements") return <PackageEntitlements />;
  const entitlementDetail = pathname.match(/^\/admin\/packages\/entitlements\/([^/]+)$/);
  if (entitlementDetail) return <PackageEntitlementDetail entitlementId={entitlementDetail[1] ?? ""} />;
  if (pathname === "/admin/customers/new") return <CustomerCreate />;
  const detail = pathname.match(/^\/admin\/customers\/([^/]+)$/);
  if (detail) return <CustomerDetail customerId={detail[1] ?? ""} />;
  return <CustomerDirectory />;
}
