import { describe, expect, it } from "vitest";
import { allocateInternalCode, insertWithAllocatedCode, optionalInternalCode } from "@/core/codes";

describe("internal codes", () => {
  it("allocates a stable CHECK-safe code without using the display name", () => {
    const code = allocateInternalCode("B-");
    expect(code.startsWith("B-")).toBe(true);
    expect(code.length).toBeLessThanOrEqual(32);
    expect(code).toMatch(/^[A-Z0-9](?:[A-Z0-9_-]{0,30}[A-Z0-9])?$/);
  });

  it("treats blank client codes as omitted", () => {
    expect(optionalInternalCode("")).toBeUndefined();
    expect(optionalInternalCode("  ")).toBeUndefined();
    expect(optionalInternalCode("JRM")).toBe("JRM");
  });

  it("retries generated codes on unique violation and does not retry explicit codes", async () => {
    let attempts = 0;
    const generated = await insertWithAllocatedCode({
      explicit: undefined,
      prefix: "D-",
      label: "Device code",
      conflictMessage: "taken",
      isUniqueViolation: (error) => error instanceof Error && error.message === "dup",
      insert: async (code) => {
        attempts += 1;
        if (attempts < 3) throw new Error("dup");
        return code;
      },
    });
    expect(attempts).toBe(3);
    expect(generated.startsWith("D-")).toBe(true);

    await expect(
      insertWithAllocatedCode({
        explicit: "PC01",
        prefix: "D-",
        label: "Device code",
        conflictMessage: "Device code is already in use in this branch",
        isUniqueViolation: () => true,
        insert: async () => {
          throw new Error("dup");
        },
      }),
    ).rejects.toThrow("Device code is already in use in this branch");
  });
});
