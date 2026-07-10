import type { ReactNode } from "react";
import "./styles.css";
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
