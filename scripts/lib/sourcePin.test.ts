import { describe, expect, it } from "vitest";

import { pinEnvName, pinnedRef } from "./sourcePin.js";

const SHA = "239632526039169dafc7cece23a1255623cd1f1a";

describe("a pinned source", () => {
  it("is named by its project, or by project and source when there are several", () => {
    expect(pinEnvName("flex", "flex")).toBe("ARCH_SOURCE_REF_FLEX");
    expect(pinEnvName("app", "ios")).toBe("ARCH_SOURCE_REF_APP_IOS");
    expect(pinEnvName("my-docs", "gov-kit")).toBe(
      "ARCH_SOURCE_REF_MY_DOCS_GOV_KIT",
    );
  });

  it("is the variable's value, and nothing when it is unset or blank", () => {
    expect(pinnedRef("udp", "udp", { ARCH_SOURCE_REF_UDP: SHA })).toEqual({
      name: "ARCH_SOURCE_REF_UDP",
      ref: SHA,
    });
    expect(pinnedRef("udp", "udp", { ARCH_SOURCE_REF_UDP: "  " })).toBeNull();
    expect(pinnedRef("udp", "udp", {})).toBeNull();
    /* The app's pin never reaches a project that happens to share a word with it. */
    expect(pinnedRef("app", "ios", { ARCH_SOURCE_REF_APP: "x" })).toBeNull();
  });

  it("refuses anything but a full commit sha, naming the variable", () => {
    expect(() =>
      pinnedRef("udp", "udp", { ARCH_SOURCE_REF_UDP: "23963252" }),
    ).toThrow(
      /ARCH_SOURCE_REF_UDP is "23963252", which is not a full commit sha/,
    );
    expect(() =>
      pinnedRef("udp", "udp", { ARCH_SOURCE_REF_UDP: "main" }),
    ).toThrow();
  });
});
