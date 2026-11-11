import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, DEFAULT_OPENROUTER_MODEL, modelChoice } from "@/agent/analyze";

describe("AI provider selection", () => {
  it("prefers Anthropic direct when its key is set", () => {
    expect(modelChoice({ ANTHROPIC_API_KEY: "k", OPENROUTER_API_KEY: "o" } as unknown as NodeJS.ProcessEnv)).toEqual({ provider: "anthropic", modelId: DEFAULT_MODEL });
  });
  it("falls back to Claude via OpenRouter", () => {
    expect(modelChoice({ OPENROUTER_API_KEY: "o" } as unknown as NodeJS.ProcessEnv)).toEqual({ provider: "openrouter", modelId: DEFAULT_OPENROUTER_MODEL });
    expect(modelChoice({ OPENROUTER_API_KEY: "o", OPENROUTER_MODEL: "anthropic/x" } as unknown as NodeJS.ProcessEnv)?.modelId).toBe("anthropic/x");
  });
  it("reports no provider when neither key is set", () => {
    expect(modelChoice({} as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
});
