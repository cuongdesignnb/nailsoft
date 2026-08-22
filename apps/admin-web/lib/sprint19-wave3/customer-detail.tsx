"use client";

import Customer360Page from "./customer-360/customer-360-page";

export default function CustomerDetail({ customerId }: { customerId: string }) {
  return <Customer360Page customerId={customerId} />;
}
