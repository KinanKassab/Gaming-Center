import { describe, expect, it } from "vitest";
import { selectedIdOrNull, syncSelectedId } from "@/ui/sync-selected-id";

describe("controlled select id sync (BUG-003)", () => {
  it("selects the first option when current id is empty and options arrive", () => {
    expect(syncSelectedId("", [])).toBe("");
    expect(syncSelectedId("", ["type-new"])).toBe("type-new");
    expect(selectedIdOrNull("", [])).toBeNull();
    expect(selectedIdOrNull("", ["type-new"])).toBe("type-new");
  });

  it("keeps a valid explicit selection when the list refreshes", () => {
    expect(syncSelectedId("type-b", ["type-a", "type-b", "type-c"])).toBe("type-b");
    expect(selectedIdOrNull("type-b", ["type-a", "type-b"])).toBe("type-b");
  });

  it("falls back when the current id is no longer in the list", () => {
    expect(syncSelectedId("gone", ["type-a", "type-b"])).toBe("type-a");
    expect(selectedIdOrNull("gone", ["type-a"])).toBe("type-a");
  });

  it("never treats an empty id as a submittable device type", () => {
    expect(selectedIdOrNull("", ["visible-but-unbound"])).toBe("visible-but-unbound");
    expect(selectedIdOrNull("", [])).toBeNull();
  });

  it("makes the first refreshed type both visible and submittable without a manual reselect", () => {
    const current = "";
    const afterCreate = ["01a04e79-new-type"];
    expect(syncSelectedId(current, afterCreate)).toBe("01a04e79-new-type");
    expect(selectedIdOrNull(current, afterCreate)).toBe("01a04e79-new-type");
    expect(selectedIdOrNull(current, afterCreate)).not.toBe("");
  });
});
