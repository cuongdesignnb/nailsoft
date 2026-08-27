import { Suspense } from "react";
import CustomerEngagement from "../../../lib/customer-engagement";
export default function Page() {
  return (
    <Suspense fallback={<p>Đang tải biểu mẫu đánh giá…</p>}>
      <CustomerEngagement mode="review" />
    </Suspense>
  );
}
