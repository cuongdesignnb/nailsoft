import type { ReactNode } from "react";
import { AdminShell } from "../../lib/admin-shell";

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
