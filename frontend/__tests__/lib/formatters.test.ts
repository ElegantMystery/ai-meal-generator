import { formatDateRange, formatCreatedAt } from "@/lib/formatters";

describe("formatDateRange()", () => {
  it("returns 'No date range' when both are null", () => {
    expect(formatDateRange(null, null)).toBe("No date range");
  });

  it("returns From <start> when only start provided", () => {
    expect(formatDateRange("2025-01-01", null)).toBe("From 2025-01-01");
  });

  it("returns Until <end> when only end provided", () => {
    expect(formatDateRange(null, "2025-01-07")).toBe("Until 2025-01-07");
  });

  it("returns range arrow format when both provided", () => {
    expect(formatDateRange("2025-01-01", "2025-01-07")).toBe(
      "2025-01-01 → 2025-01-07",
    );
  });
});

describe("formatCreatedAt()", () => {
  it("returns empty string for null", () => {
    expect(formatCreatedAt(null)).toBe("");
  });

  it("returns original string for invalid ISO", () => {
    expect(formatCreatedAt("not-a-date")).toBe("not-a-date");
  });

  it("returns a non-empty string for a valid ISO timestamp", () => {
    const result = formatCreatedAt("2025-01-15T10:30:00.000Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // Should NOT contain the raw 'T' or 'Z' from the ISO string
    expect(result).not.toContain("T10:");
    expect(result).not.toContain("000Z");
  });

  it("handles ISO with timezone offset", () => {
    // Should not throw or return the raw ISO string
    const result = formatCreatedAt("2025-01-15T10:30:00+00:00");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
