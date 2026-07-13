import { describe, expect, it } from "vitest";
import { BOYA_SKILL_IDS, classifySkills } from "./SkillsPage";

describe("SkillsPage grouping", () => {
  it("defines the complete Boya workflow and separates utility skills", () => {
    expect(BOYA_SKILL_IDS.size).toBe(15);
    const grouped = classifySkills([
      { name: "boya" },
      { name: "reference-check" },
      { name: "pdf" },
      { name: "traceability-review" },
    ]);
    expect(grouped.boyaSkills.map((skill) => skill.name)).toEqual(["boya", "reference-check"]);
    expect(grouped.utilitySkills.map((skill) => skill.name)).toEqual(["pdf", "traceability-review"]);
  });

  it("does not recognize the autonomous ai4s-agent as a Boya workflow skill", () => {
    expect(BOYA_SKILL_IDS.has("ai4s-agent")).toBe(false);
  });
});
