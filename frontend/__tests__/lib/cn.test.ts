import { cn } from "@/lib/cn";

describe("cn()", () => {
  it("returns empty string when no args", () => {
    expect(cn()).toBe("");
  });

  it("returns a single class string unchanged", () => {
    expect(cn("text-sm")).toBe("text-sm");
  });

  it("joins multiple class strings", () => {
    expect(cn("text-sm", "font-bold")).toBe("text-sm font-bold");
  });

  it("ignores falsy values", () => {
    expect(cn("text-sm", undefined, null, false, "font-bold")).toBe(
      "text-sm font-bold",
    );
  });

  it("resolves Tailwind conflicts — last value wins", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("handles conditional object syntax", () => {
    expect(cn({ "text-sm": true, "font-bold": false })).toBe("text-sm");
  });

  it("merges padding variants correctly", () => {
    expect(cn("p-4", "px-2")).toBe("p-4 px-2");
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
