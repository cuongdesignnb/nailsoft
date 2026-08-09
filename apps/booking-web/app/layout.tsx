import type { ReactNode } from "react";
import "./styles.css";

export const metadata = {
  title: "Nailsoft | Online booking",
  description: "Book a salon appointment with Nailsoft.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi-VN">
      <body>{children}</body>
    </html>
  );
}
