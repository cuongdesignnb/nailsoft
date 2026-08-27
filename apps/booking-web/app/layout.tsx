import type { ReactNode } from "react";
import "./styles.css";

export const metadata = {
  title: "NailSoft | Đặt lịch",
  description: "Đặt lịch dịch vụ tại NailSoft.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi-VN">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
