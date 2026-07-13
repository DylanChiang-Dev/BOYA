import { useTranslation } from "react-i18next";
import { BookCheck, ChevronRight, CircleHelp, Compass, ScanSearch } from "lucide-react";

export interface WorkflowStarter {
  id: string;
  icon: React.ReactNode;
  /** Sent to the agent as-is — content, not UI copy, so it is never translated.
   *  The card's display title/description live in `session:starters.<id>.*`. */
  prompt: string;
}

/** Focused entry points. Each prompt invokes one Boya stage and preserves the
 *  human decision gate instead of starting an autonomous research pipeline. */
export const WORKFLOW_STARTERS: WorkflowStarter[] = [
  {
    id: "boya",
    icon: <Compass size={17} strokeWidth={1.75} />,
    prompt:
      "Use the boya skill to inspect the research artifacts in this workspace, locate my current stage, " +
      "and carry out only the next focused stage. Stop at the next decision that only I can make.",
  },
  {
    id: "question",
    icon: <CircleHelp size={17} strokeWidth={1.75} />,
    prompt:
      "Use the research-question skill to help me turn a broad research interest into a bounded, " +
      "researchable question. Ask only the questions that change the direction, and do not choose the final question for me.",
  },
  {
    id: "references",
    icon: <BookCheck size={17} strokeWidth={1.75} />,
    prompt:
      "Use the reference-check skill to verify the reference list in this workspace. Check every entry, " +
      "record the sources searched, and mark items not found as pending rather than fabricated.",
  },
  {
    id: "review",
    icon: <ScanSearch size={17} strokeWidth={1.75} />,
    prompt:
      "Use the manuscript-review skill to review the manuscript in this workspace. Separate findings into " +
      "must-fix, defensible, and likely misread, and leave every adoption decision to me.",
  },
];

/**
 * Empty-session welcome: a quiet, centered composition in the app's paper
 * aesthetic. The conversation is the point, so the copy invites a message
 * first; the starters below are an optional on-ramp, not a dashboard.
 */
export function WorkflowStarters({ onPick }: { onPick: (prompt: string) => void }) {
  const { t } = useTranslation(["session", "common"]);
  // Display copy per starter id — t()'s generated key type rejects a dynamic
  // `starters.${id}.title` template, so each card's copy is looked up by id
  // from this literal-keyed map instead.
  const starterCopy: Record<string, { title: string; description: string }> = {
    boya: { title: t("starters.boya.title"), description: t("starters.boya.description") },
    question: { title: t("starters.question.title"), description: t("starters.question.description") },
    references: { title: t("starters.references.title"), description: t("starters.references.description") },
    review: { title: t("starters.review.title"), description: t("starters.review.description") },
  };
  return (
    <div className="flex min-h-[62vh] flex-col items-center justify-center">
      <div className="w-full max-w-[500px]">
        <div className="text-center">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.2em] text-muted">
            {t("starters.newSession")}
          </div>
          <h2 className="mt-2.5 font-serif text-[26px] leading-tight text-text">
            {t("starters.heading")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{t("starters.subheading")}</p>
        </div>

        <div className="mt-7 overflow-hidden rounded-card border border-border bg-surface shadow-card">
          {WORKFLOW_STARTERS.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s.prompt)}
              className="group flex w-full items-center gap-3.5 border-t border-border px-4 py-3.5 text-left transition-colors first:border-t-0 hover:bg-surface-2"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-accent ring-1 ring-border transition-colors group-hover:bg-surface">
                {s.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium text-text">
                  {starterCopy[s.id]?.title}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted">
                  {starterCopy[s.id]?.description}
                </span>
              </span>
              <ChevronRight
                size={16}
                className="shrink-0 text-muted/60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-muted"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
