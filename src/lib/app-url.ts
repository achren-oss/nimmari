export function appUrl(): string {
  return (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? process.env.RENDER_EXTERNAL_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function authBaseUrl(): string | undefined {
  return (process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL)?.replace(/\/+$/, "");
}
