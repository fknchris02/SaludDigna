import { describe, expect, it } from "vitest";
import { median } from "./admin-stats";

describe("median", () => {
  it("sin datos, impar y par", () => {
    expect(median([])).toBeNull();
    expect(median([9, 1, 5])).toBe(5);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
