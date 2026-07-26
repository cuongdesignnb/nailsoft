import { DateTime } from "luxon";

export function branchLocalDate(
  instant: Date | string,
  timezone: string,
): string {
  const value =
    instant instanceof Date
      ? DateTime.fromJSDate(instant, { zone: "utc" })
      : DateTime.fromISO(instant, { setZone: true });
  return value.setZone(timezone).toISODate()!;
}

export function branchLocalDayRange(localDate: string, timezone: string) {
  const start = DateTime.fromISO(localDate, { zone: timezone }).startOf("day");
  if (!start.isValid)
    throw new Error(`Invalid local date or timezone: ${localDate}/${timezone}`);
  const end = start.plus({ days: 1 }).startOf("day");
  return {
    startUtc: start.toUTC().toISO()!,
    endUtc: end.toUTC().toISO()!,
  };
}

export function roundUpBranchTime(
  instant: Date | string,
  timezone: string,
  intervalMinutes = 5,
) {
  const source =
      instant instanceof Date
        ? DateTime.fromJSDate(instant, { zone: "utc" })
        : DateTime.fromISO(instant, { setZone: true }),
    local = source.setZone(timezone),
    hasPartialMinute = local.second !== 0 || local.millisecond !== 0,
    minuteBase = hasPartialMinute
      ? local.startOf("minute").plus({ minutes: 1 })
      : local.startOf("minute"),
    remainder = minuteBase.minute % intervalMinutes,
    rounded = remainder
      ? minuteBase.plus({ minutes: intervalMinutes - remainder })
      : minuteBase;
  return rounded.toUTC();
}
