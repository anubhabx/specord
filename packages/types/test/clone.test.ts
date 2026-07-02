import { describe, expect, it } from "vitest";
import { cloneJsonValue } from "../src/clone.js";

describe("cloneJsonValue", () => {
  it("serializes common non-plain decorator values", () => {
    const cloned = cloneJsonValue({
      date: new Date("2026-01-02T03:04:05.000Z"),
      pattern: /specord/gi,
      map: new Map<string, unknown>([
        ["status", "active"],
        ["count", 2],
      ]),
      set: new Set(["read", "write"]),
    });

    expect(cloned).toEqual({
      date: "2026-01-02T03:04:05.000Z",
      pattern: "/specord/gi",
      map: {
        status: "active",
        count: 2,
      },
      set: ["read", "write"],
    });
  });

  it("preserves existing cycle handling for objects", () => {
    const input: Record<string, unknown> = { name: "loop" };
    input.self = input;

    const cloned = cloneJsonValue(input);

    expect(cloned).not.toBe(input);
    expect(cloned.self).toBe(cloned);
  });
});
