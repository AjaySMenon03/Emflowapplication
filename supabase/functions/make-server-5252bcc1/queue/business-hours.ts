/**
 * EM Flow — Business Hours Validation
 */

import * as kv from "../kv_store.tsx";
import type { BusinessHoursCheck } from "./types.ts";
import { nowInTimezone } from "./timezone.ts";

/**
 * Check if a location is currently within business hours.
 * Uses the location's timezone for time calculations.
 */
export async function checkBusinessHours(locationId: string): Promise<BusinessHoursCheck> {
    const location = await kv.get(`location:${locationId}`);
    if (!location) {
        return { isOpen: true }; // default: open if no location found
    }

    const timezone = location.timezone || "UTC";
    const hoursRecord = await kv.get(`business_hours:${locationId}`);

    if (!hoursRecord || !hoursRecord.hours) {
        return { isOpen: true }; // default: always open if no hours configured
    }

    const { hours, minutes, dayName } = nowInTimezone(timezone);
    const todaySchedule = hoursRecord.hours[dayName];

    if (!todaySchedule) {
        return { isOpen: true }; // no schedule for today = open
    }

    if (!todaySchedule.open) {
        return {
            isOpen: false,
            reason: `Closed on ${dayName.charAt(0).toUpperCase() + dayName.slice(1)}`,
            daySchedule: todaySchedule,
        };
    }

    const currentMinutes = hours * 60 + minutes;
    const [openH, openM] = (todaySchedule.openTime || "09:00").split(":").map(Number);
    const [closeH, closeM] = (todaySchedule.closeTime || "18:00").split(":").map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    if (currentMinutes < openMinutes) {
        return {
            isOpen: false,
            reason: `Not yet open — opens at ${todaySchedule.openTime}`,
            opensAt: todaySchedule.openTime,
            closesAt: todaySchedule.closeTime,
            daySchedule: todaySchedule,
        };
    }

    if (currentMinutes > closeMinutes) {
        return {
            isOpen: false,
            reason: `Closed for the day — closed at ${todaySchedule.closeTime}`,
            opensAt: todaySchedule.openTime,
            closesAt: todaySchedule.closeTime,
            daySchedule: todaySchedule,
        };
    }

    return {
        isOpen: true,
        opensAt: todaySchedule.openTime,
        closesAt: todaySchedule.closeTime,
        daySchedule: todaySchedule,
    };
}
