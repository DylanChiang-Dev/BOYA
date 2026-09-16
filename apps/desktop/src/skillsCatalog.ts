import catalog from "./generated/skills-catalog.json";

export type SkillCatalogRole = "entry" | "optional" | "workflow";

export interface SkillCatalogEntry {
  id: string;
  role: SkillCatalogRole;
  stage: number;
  displayName: string;
  shortDescription: string;
  defaultPrompt: string;
}

interface SkillCatalog {
  schemaVersion: 1;
  name: "boya";
  version: string;
  skillCount: number;
  skills: SkillCatalogEntry[];
}

export const skillsCatalog = catalog as SkillCatalog;

export const skillStageGroups = [
  { id: "all", label: "全部 Skills", stages: null },
  { id: "start", label: "定位與起步", stages: [0, 1] },
  { id: "evidence", label: "文獻與查核", stages: [2, 3, 4] },
  { id: "design", label: "框架與設計", stages: [5, 6, 7] },
  { id: "finish", label: "修訂與交付", stages: [8, 9, 10, 11, 12, 13, 14] },
] as const;
