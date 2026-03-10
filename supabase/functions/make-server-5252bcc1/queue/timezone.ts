/**
 * Quecumber — Timezone Helpers
 */

import { today } from "./helpers.ts";

/**
 * Get current date string (YYYY-MM-DD) in a specific timezone.
 */
export function todayInTimezone(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date()); // returns YYYY-MM-DD in en-CA locale
  } catch {
    return today(); // fallback to UTC
  }
}

/**
 * Get current time parts (hours, minutes) in a specific timezone.
 */
export function nowInTimezone(timezone: string): {
  hours: number;
  minutes: number;
  dayName: string;
} {
  try {
    const nowDate = new Date();
    const hourFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const minuteFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      minute: "numeric",
    });
    const dayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
    });

    const hours = parseInt(hourFormatter.format(nowDate), 10);
    const minutes = parseInt(minuteFormatter.format(nowDate), 10);
    const dayName = dayFormatter.format(nowDate).toLowerCase();

    return { hours, minutes, dayName };
  } catch {
    const nowDate = new Date();
    const dayNames = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    return {
      hours: nowDate.getUTCHours(),
      minutes: nowDate.getUTCMinutes(),
      dayName: dayNames[nowDate.getUTCDay()],
    };
  }
}
