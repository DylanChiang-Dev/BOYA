export type ModelAccessMode = "boya-cloud" | "developer-byok";

/** Stable client contract for the future Boya Cloud gateway. */
export const BOYA_CLOUD_CONTRACT = Object.freeze({
  protocol: "openai-compatible-sse" as const,
  chatCompletionsPath: "/v1/chat/completions" as const,
  model: "boya-standard" as const,
});
