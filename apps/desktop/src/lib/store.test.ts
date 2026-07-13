import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./store";

describe("uiStore theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUiStore.setState({ theme: "light" });
  });

  it("toggles theme and persists to localStorage", () => {
    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe("dark");
    expect(window.localStorage.getItem("boya.theme")).toBe("dark");

    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe("light");
    expect(window.localStorage.getItem("boya.theme")).toBe("light");
  });
});

describe("uiStore model access", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useUiStore.setState({ modelAccessMode: "boya-cloud" });
  });

  it("uses Boya Cloud by default and persists developer BYOK explicitly", () => {
    expect(useUiStore.getState().modelAccessMode).toBe("boya-cloud");
    useUiStore.getState().setModelAccessMode("developer-byok");
    expect(useUiStore.getState().modelAccessMode).toBe("developer-byok");
    expect(window.localStorage.getItem("boya.modelAccessMode")).toBe("developer-byok");
  });
});
