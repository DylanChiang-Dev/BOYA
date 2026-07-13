import { describe, expect, it } from "vitest";
import { BOYA_CLOUD_CONTRACT } from "./modelAccess";

describe("Boya Cloud model contract", () => {
  it("keeps the future gateway protocol and public model alias stable", () => {
    expect(BOYA_CLOUD_CONTRACT).toEqual({
      protocol: "openai-compatible-sse",
      chatCompletionsPath: "/v1/chat/completions",
      model: "boya-standard",
    });
  });
});
