import { Suspense } from "react";
import CustomerEngagement from "../../../lib/customer-engagement";
export default function Page() {
  return (
    <Suspense fallback={<p>Đang tải lựa chọn email…</p>}>
      <CustomerEngagement mode="unsubscribe" />
    </Suspense>
  );
}
