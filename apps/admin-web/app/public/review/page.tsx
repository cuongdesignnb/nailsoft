import { Suspense } from "react";
import CustomerEngagement from "../../../lib/customer-engagement";
export default function Page() {
  return (
    <Suspense fallback={<p>Loading review form...</p>}>
      <CustomerEngagement mode="review" />
    </Suspense>
  );
}
