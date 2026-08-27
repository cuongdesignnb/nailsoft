import { Suspense } from "react";
import CustomerEngagement from "../../../lib/customer-engagement";
export default function Page() {
  return (
    <Suspense fallback={<p>Đang tải lựa chọn liên hệ…</p>}>
      <CustomerEngagement mode="preferences" />
    </Suspense>
  );
}
