export function assertCapacityAvailable(
  used: number,
  capacity: number,
  adding: number,
): void {
  if (used + adding > capacity) {
    throw new Error("Capacidade esgotada para este evento.");
  }
}
