/** Milliseconds for a D1 timestamp. SQLite's datetime('now') carries no zone, but it is UTC. */
export function parseSqliteDate(value: string): number {
  return Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(value) ? value : value.replace(" ", "T") + "Z");
}
