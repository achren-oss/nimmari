import { afterEach, expect, it, vi } from "vitest";
import { appUrl, authBaseUrl } from "../app-url";
afterEach(() => vi.unstubAllEnvs());
it("uses public and auth precedence while preserving local auth inference", () => {
  for (const key of ["APP_URL", "BETTER_AUTH_URL", "RENDER_EXTERNAL_URL"]) vi.stubEnv(key, undefined);
  expect(appUrl()).toBe("http://localhost:3000");
  expect(authBaseUrl()).toBeUndefined();
  vi.stubEnv("RENDER_EXTERNAL_URL", "https://service.onrender.com/");
  expect(appUrl()).toBe("https://service.onrender.com");
  expect(authBaseUrl()).toBe("https://service.onrender.com");
  vi.stubEnv("APP_URL", "https://public.example///");
  vi.stubEnv("BETTER_AUTH_URL", "https://auth.example/");
  expect(appUrl()).toBe("https://public.example");
  expect(authBaseUrl()).toBe("https://auth.example");
});
