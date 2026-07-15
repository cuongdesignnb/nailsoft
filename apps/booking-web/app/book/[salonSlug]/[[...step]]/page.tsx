import BookingFlow from "../../../../lib/booking-flow";
export default async function Page({
  params,
}: {
  params: Promise<{ salonSlug: string }>;
}) {
  const { salonSlug } = await params;
  return <BookingFlow salonSlug={salonSlug} />;
}
