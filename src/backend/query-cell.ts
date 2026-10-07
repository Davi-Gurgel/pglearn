// The renderer gets text, with SQL NULL preserved separately.
export function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    // sql-pg maps both infinities and out-of-range timestamps to invalid Dates.
    // Their original value cannot be recovered, so never guess or show NULL.
    if (Number.isNaN(value.getTime())) {
      throw new Error(
        "Cannot display a timestamp that is infinite or outside JavaScript's date range. Cast the timestamp column to text in your query (::text).",
      );
    }
    return value.toISOString();
  }
  if (typeof value === "object") {
    return JSON.stringify(value, function (this: Record<string, unknown>, key, cell: unknown) {
      // Date.toJSON runs before the replacer, turning invalid Dates into null.
      // Inspect the original value so nested timestamps get the same checks.
      const original = this[key];
      if (original instanceof Date) return toText(original);
      return typeof cell === "bigint" ? String(cell) : cell;
    });
  }
  return String(value);
}
