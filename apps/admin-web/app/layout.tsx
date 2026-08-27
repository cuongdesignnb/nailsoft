import type { ReactNode } from "react";
import "@fontsource-variable/inter/wght.css";
import { cssVariables } from "@nailsoft/design-tokens";
import "./styles.css";
export const metadata = {
  title: "NailSoft CMS",
  description: "Quản lý vận hành salon theo tenant và chi nhánh.",
};
export default function Layout({ children }: { children: ReactNode }) {
  const variables = cssVariables.map(([key, value]) => `${key}:${value}`).join(";");
  return (
    <html lang="vi">
      <body suppressHydrationWarning><style>{`:root{${variables}}`}</style>{children}</body>
    </html>
  );
}
