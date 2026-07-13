import { describe, expect, it } from "vitest";
import { SCIENCE_CONNECTORS, connectorConfig } from "./scienceConnectors";

const byId = (id: string) => {
  const c = SCIENCE_CONNECTORS.find((x) => x.id === id);
  if (!c) throw new Error(`no connector ${id}`);
  return c;
};

describe("connectorConfig", () => {
  it("launches a `-m module` connector (paper-search)", () => {
    const cfg = connectorConfig(byId("paper-search"), "/env/bin/python");
    expect(cfg).toMatchObject({
      type: "local",
      command: ["/env/bin/python", "-m", "paper_search_mcp.server"],
      enabled: true,
    });
    expect(cfg.type === "local" && cfg.environment).toBeUndefined();
  });

  it("launches FRED beside the interpreter (unix)", () => {
    const cfg = connectorConfig(byId("fred"), "/env/bin/python");
    expect(cfg.type === "local" && cfg.command).toEqual(["/env/bin/fred-mcp"]);
  });

  it("resolves the console script on Windows with .exe", () => {
    const cfg = connectorConfig(byId("fred"), "C:\\env\\Scripts\\python.exe", "KEY");
    expect(cfg.type === "local" && cfg.command).toEqual([
      "C:\\env\\Scripts\\fred-mcp.exe",
    ]);
  });

  it("passes an API key via environment, trimmed", () => {
    const cfg = connectorConfig(byId("fred"), "/env/bin/python", "  fred-secret  ");
    expect(cfg.type === "local" && cfg.environment).toEqual({ FRED_API_KEY: "fred-secret" });
  });

  it("omits environment when the key is blank", () => {
    const cfg = connectorConfig(byId("fred"), "/env/bin/python", "   ");
    expect(cfg.type === "local" && cfg.environment).toBeUndefined();
  });

  it("every connector declares an id, discipline, package, and a launch path", () => {
    for (const c of SCIENCE_CONNECTORS) {
      expect(c.id && c.discipline && c.pkg && c.source).toBeTruthy();
      expect(Boolean(c.bin) || Boolean(c.module)).toBe(true);
      if (c.apiKeyEnv) expect(c.apiKeyUrl).toBeTruthy(); // key-needing → tell users where to get one
    }
  });

  it("exposes only the humanities and social-science connector allowlist", () => {
    expect(SCIENCE_CONNECTORS.map((connector) => connector.id)).toEqual([
      "paper-search",
      "fred",
    ]);
  });
});
