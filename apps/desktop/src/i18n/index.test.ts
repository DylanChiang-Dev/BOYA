import { beforeEach, describe, expect, it } from "vitest";
import i18n, { NAMESPACES } from "./index";

describe("i18n instance", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-Hant");
  });

  it("uses Traditional Chinese and the full namespace set", () => {
    expect(i18n.language).toBe("zh-Hant");
    expect(NAMESPACES).toContain("common");
    expect(NAMESPACES.length).toBe(8);
  });

  it("resolves a seeded key", () => {
    expect(i18n.t("common:actions.save")).toBe("保存");
  });

  it("falls back to Traditional Chinese for a not-yet-shipped language", async () => {
    await i18n.changeLanguage("pt-BR");
    expect(i18n.t("common:actions.save")).toBe("保存");
  });
});
