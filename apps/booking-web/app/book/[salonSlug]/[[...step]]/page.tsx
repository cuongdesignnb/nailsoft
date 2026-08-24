import BookingFlow from "../../../../lib/booking-flow";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ salonSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { salonSlug } = await params;
  const query = await searchParams;
  const raw = query.attribution;
  const attributionReference = Array.isArray(raw) ? raw[0] : raw;
  return <BookingFlow salonSlug={salonSlug} {...(attributionReference ? { attributionReference } : {})} />;
}
