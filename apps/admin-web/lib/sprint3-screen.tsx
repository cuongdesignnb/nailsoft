"use client";

import Sprint19Wave1Screen from "./sprint19-wave1-screen";
import Sprint19Wave1Remediation from "./sprint19-wave1-remediation";

/**
 * Compatibility entry for the original Sprint 3 import.
 *
 * The active dispatcher already sends these routes to the Wave 1 screens. Keeping
 * this adapter means older imports remain valid without retaining the old demo
 * dates, fixed branch IDs or a second scheduling implementation.
 */
export default function Sprint3Screen({ pathname }: { pathname: string }) {
  if (pathname.startsWith("/admin/scheduling/blocks")) {
    return <Sprint19Wave1Remediation pathname={pathname} />;
  }
  return <Sprint19Wave1Screen pathname={pathname} />;
}
