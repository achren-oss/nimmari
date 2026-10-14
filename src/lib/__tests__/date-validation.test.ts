import { describe, it, expect } from "vitest";
import { validateAndNormalizeDate } from "../validators";

describe("validateAndNormalizeDate", () => {
  it("accepts ISO format dates", () => {
    expect(validateAndNormalizeDate("2023-12-25")).toBe("2023-12-25");
    expect(validateAndNormalizeDate("2000-01-01")).toBe("2000-01-01");
  });

  it("accepts DD.MM.YYYY format", () => {
    expect(validateAndNormalizeDate("25.12.2023")).toBe("2023-12-25");
    expect(validateAndNormalizeDate("01.01.2000")).toBe("2000-01-01");
    expect(validateAndNormalizeDate("1.1.2000")).toBe("2000-01-01");
  });

  it("accepts DD/MM/YYYY format", () => {
    expect(validateAndNormalizeDate("25/12/2023")).toBe("2023-12-25");
    expect(validateAndNormalizeDate("01/01/2000")).toBe("2000-01-01");
    expect(validateAndNormalizeDate("1/1/2000")).toBe("2000-01-01");
  });

  it("rejects invalid dates", () => {
    expect(validateAndNormalizeDate("2023-02-30")).toBe(null); // Feb 30 doesn't exist
    expect(validateAndNormalizeDate("2023-13-01")).toBe(null); // Month 13 doesn't exist
    expect(validateAndNormalizeDate("abc")).toBe(null);
    expect(validateAndNormalizeDate("")).toBe(null);
    expect(validateAndNormalizeDate("32.12.2023")).toBe(null); // Day 32 doesn't exist
  });

  it("handles edge cases", () => {
    expect(validateAndNormalizeDate("29.02.2024")).toBe("2024-02-29"); // Leap year
    expect(validateAndNormalizeDate("29.02.2023")).toBe(null); // Not a leap year
  });
});
