const IST_OFFSET_MS = 19_800_000; // +05:30, no daylight saving

/** `2026-11-23T13:00:00+05:30`, the slot format in the prompt input (SPEC §6.2). */
export function istIso(time: Date): string {
  return `${new Date(time.getTime() + IST_OFFSET_MS).toISOString().slice(0, 19)}+05:30`;
}

/** True for the 09:00 IST slot. Pass the slot's scheduled time, not the time the job ran. */
export function isNineAmSlot(slotTime: Date): boolean {
  return istIso(slotTime).slice(11, 16) === "09:00";
}
