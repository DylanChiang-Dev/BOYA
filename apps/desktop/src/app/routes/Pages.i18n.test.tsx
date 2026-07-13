import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderAt } from "@/test/render";
import { useUiStore } from "@/lib/store";
import { useRuntimeStore } from "@/lib/runtime";

// COPYCAT RULE: useUiStore is module-global; reset the locale after each test
// so this suite never bleeds a non-English locale into other test files.
afterEach(() => useUiStore.getState().setLocale("en"));

// COPYCAT RULE: useRuntimeStore is also module-global — restore the
// disconnected default after any test that fakes a "ready" runtime.
const RUNTIME_DEFAULTS = {
  status: useRuntimeStore.getState().status,
  agents: useRuntimeStore.getState().agents,
  skills: useRuntimeStore.getState().skills,
};
afterEach(() => useRuntimeStore.setState(RUNTIME_DEFAULTS));

describe("NotebooksPage strings (i18n)", () => {
  it("renders the page heading and the desktop-only empty state in English", async () => {
    renderAt("/notebooks");
    expect(await screen.findByRole("heading", { level: 1, name: "Notebooks" })).toBeInTheDocument();
    expect(screen.getByText("Notebooks are available in the desktop app.")).toBeInTheDocument();
    expect(screen.getByText("New notebook")).toBeInTheDocument();
  });
});

describe("FilesPage strings (i18n)", () => {
  it("renders the desktop-only explorer message and the preview prompt in English", async () => {
    renderAt("/files");
    expect(await screen.findByText("The file explorer is available in the desktop app.")).toBeInTheDocument();
    expect(screen.getByText("Select a file to preview it here.")).toBeInTheDocument();
  });
});

describe("SkillsPage strings (i18n)", () => {
  it("renders the page heading and the disconnected-runtime prompts in English", async () => {
    renderAt("/skills");
    expect(await screen.findByRole("heading", { level: 1, name: "Skills" })).toBeInTheDocument();
    expect(screen.getByText("Environment detection runs in the desktop app.")).toBeInTheDocument();
    expect(
      screen.getByText("Connect the runtime to list the skills it has loaded."),
    ).toBeInTheDocument();
  });

  it("groups Boya workflow skills separately from supporting tools", async () => {
    useRuntimeStore.setState({
      status: "ready",
      skills: [
        { name: "boya", description: "Boya entry workflow", location: "/builtin/boya" },
        { name: "pdf", description: "PDF utility", location: "/builtin/pdf" },
      ],
    });
    renderAt("/skills");
    expect(await screen.findByText("Boya workflow (1)")).toBeInTheDocument();
    expect(screen.getByText("Supporting tools (1)")).toBeInTheDocument();
    expect(screen.getByText("boya")).toBeInTheDocument();
    expect(screen.getByText("pdf")).toBeInTheDocument();
  });
});
