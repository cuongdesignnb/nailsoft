import { Suspense } from "react";
import CustomerEngagement from "../../../lib/customer-engagement";
export default function Page() {
  return (
    <Suspense fallback={<p>Đang tải quyền liên hệ…</p>}>
      <CustomerEngagement mode="consents" />
    </Suspense>
  );
}
