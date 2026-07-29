import { Suspense } from "react";
import CustomerEngagement from "../../../lib/customer-engagement";
export default function Page() {
  return (
    <Suspense fallback={<p>Loading unsubscribe preferences…</p>}>
      <CustomerEngagement mode="unsubscribe" />
    </Suspense>
  );
}
