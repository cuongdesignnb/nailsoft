import { Suspense } from "react";
import CustomerEngagement from "../../../lib/customer-engagement";
export default function Page() {
  return (
    <Suspense fallback={<p>Loading consent history...</p>}>
      <CustomerEngagement mode="consents" />
    </Suspense>
  );
}
