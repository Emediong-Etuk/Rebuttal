export const REPO_URL = "https://github.com/emediong-etuk/rebuttal";

/**
 * Public base URL used in approval links and Telegram buttons.
 * On Vercel production, the platform's own production domain wins, so a mistyped APP_URL cannot send
 * sellers to the wrong site. Elsewhere APP_URL is used (Render, local dev).
 */
export function baseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const vercelProd = env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : null;
  return (vercelProd ?? env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
