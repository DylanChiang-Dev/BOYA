import { Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { skillStageGroups, skillsCatalog, type SkillCatalogEntry } from "./skillsCatalog";

interface SkillsLibraryProps {
  running: boolean;
  onStart: (skill: SkillCatalogEntry) => void;
}

export function SkillsLibrary({ running, onStart }: SkillsLibraryProps) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<(typeof skillStageGroups)[number]["id"]>("all");
  const [selectedId, setSelectedId] = useState(skillsCatalog.skills[0]?.id ?? "");
  const selected = skillsCatalog.skills.find((skill) => skill.id === selectedId) ?? skillsCatalog.skills[0];
  const activeGroup = skillStageGroups.find((item) => item.id === group) ?? skillStageGroups[0];
  const skills = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return skillsCatalog.skills.filter((skill) => {
      const inGroup = !activeGroup.stages || activeGroup.stages.includes(skill.stage as never);
      const matches = !keyword || [skill.displayName, skill.id, skill.shortDescription]
        .join(" ")
        .toLocaleLowerCase()
        .includes(keyword);
      return inGroup && matches;
    });
  }, [activeGroup.stages, query]);

  return <section className="skills-view" aria-labelledby="skills-title">
    <header className="skills-view-header">
      <div>
        <p>BOYA Skills · {skillsCatalog.version}</p>
        <h1 id="skills-title">Skills 廣場</h1>
        <span>17 個官方研究工具已隨 BOYA 打包，所有研究判斷仍由你決定。</span>
      </div>
      <div className="skills-search">
        <Search size={16} />
        <input aria-label="搜尋 Skills" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋 Skill" />
      </div>
    </header>
    <div className="skills-stage-tabs" role="tablist" aria-label="Skills 階段">
      {skillStageGroups.map((item) => <button key={item.id} type="button" role="tab" aria-selected={group === item.id} className={group === item.id ? "active" : ""} onClick={() => setGroup(item.id)}>{item.label}</button>)}
    </div>
    <div className="skills-library-layout">
      <div className="skills-grid" aria-live="polite">
        {skills.map((skill) => <button key={skill.id} type="button" className={`skill-card ${selected?.id === skill.id ? "active" : ""}`} onClick={() => setSelectedId(skill.id)}>
          <span>{String(skill.stage).padStart(2, "0")}</span>
          <strong>{skill.displayName}</strong>
          <code>{skill.id}</code>
          <p>{skill.shortDescription}</p>
        </button>)}
        {skills.length === 0 && <p className="skills-empty">找不到符合條件的 Skill。</p>}
      </div>
      {selected && <aside className="skill-detail">
        <span className="skill-detail-stage">Stage {String(selected.stage).padStart(2, "0")}</span>
        <h2>{selected.displayName}</h2>
        <code>{selected.id}</code>
        <p>{selected.shortDescription}</p>
        <div className="skill-prompt"><span>新對話預設提示</span><p>{selected.defaultPrompt}</p></div>
        <button className="primary-button skill-start" type="button" disabled={running} onClick={() => onStart(selected)}><Sparkles size={16} />{running ? "請先停止目前回合" : "用此 Skill 開始"}</button>
        <small>會建立新對話並帶入提示，不會自動送出。</small>
      </aside>}
    </div>
  </section>;
}
