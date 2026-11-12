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

describe("public base URL", () => {
  it("uses Vercel's production domain over a mistyped APP_URL", async () => {
    const { baseUrl } = await import("@/lib/site");
    const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
    expect(baseUrl(env({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "rebuttal-eta.vercel.app", APP_URL: "https://wrong.example" }))).toBe("https://rebuttal-eta.vercel.app");
    expect(baseUrl(env({ APP_URL: "https://x.onrender.com/" }))).toBe("https://x.onrender.com");
    expect(baseUrl(env({}))).toBe("http://localhost:3000");
  });
});
