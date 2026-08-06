"use client";

import CustomerCreate from "./sprint19-wave3/customer-create";
import CustomerDetail from "./sprint19-wave3/customer-detail";
import CustomerDirectory from "./sprint19-wave3/customer-directory";
import { isWave3CustomerPath } from "./sprint19-wave3/routes";

export { isWave3CustomerPath };

export default function Sprint19Wave3CustomerScreen({ pathname }: { pathname: string }) {
  if (pathname === "/admin/customers/new") return <CustomerCreate />;
  const detail = pathname.match(/^\/admin\/customers\/([^/]+)$/);
  if (detail) return <CustomerDetail customerId={detail[1] ?? ""} />;
  return <CustomerDirectory />;
}
