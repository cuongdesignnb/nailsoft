import { notFound } from "next/navigation";
import { AdminShell } from "../../../lib/admin-shell";
import { GalleryContent } from "./gallery-content";

export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production" && process.env.NAILSOFT_ENABLE_COMPONENT_GALLERY !== "true") notFound();
  return <AdminShell><GalleryContent /></AdminShell>;
}
