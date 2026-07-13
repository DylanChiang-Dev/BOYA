import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WORKFLOW_STARTERS, WorkflowStarters } from "./WorkflowStarters";

describe("WorkflowStarters", () => {
  it("renders four focused Boya entry points", () => {
    render(<WorkflowStarters onPick={() => {}} />);
    expect(screen.getByText("Continue with Boya")).toBeInTheDocument();
    expect(screen.getByText("Refine a research question")).toBeInTheDocument();
    expect(screen.getByText("Verify a reference list")).toBeInTheDocument();
    expect(screen.getByText("Review a manuscript")).toBeInTheDocument();
    expect(WORKFLOW_STARTERS).toHaveLength(4);
  });

  it("starts with boya and preserves the next human decision gate", async () => {
    const onPick = vi.fn();
    render(<WorkflowStarters onPick={onPick} />);
    await userEvent.click(screen.getByText("Continue with Boya"));
    expect(onPick).toHaveBeenCalledWith(expect.stringContaining("Use the boya skill"));
    expect(onPick.mock.calls[0][0]).toContain("Stop at the next decision");
  });

  it("never starts an autonomous end-to-end research pipeline", () => {
    const prompts = WORKFLOW_STARTERS.map((starter) => starter.prompt).join("\n");
    expect(prompts).not.toMatch(/ai4s-agent|complete demo analysis|end to end/i);
    expect(prompts).toMatch(/do not choose|leave every adoption decision to me/i);
  });
});
