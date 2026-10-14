import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), findFirst: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/db", () => ({ db: { query: { user: { findFirst: mocks.findFirst } } } }));
import { getServerSession } from "../session";
beforeEach(() => vi.resetAllMocks());
it("rejects existing sessions after an account is disabled or deleted", async () => {
  const session = { user: { id: "owner" } };
  mocks.getSession.mockResolvedValue(session);
  mocks.findFirst.mockResolvedValue({ id: "owner", disabledAt: null });
  expect(await getServerSession()).toBe(session);
  mocks.findFirst.mockResolvedValue({ id: "owner", disabledAt: new Date() });
  expect(await getServerSession()).toBeNull();
  mocks.findFirst.mockResolvedValue(undefined);
  expect(await getServerSession()).toBeNull();
  mocks.getSession.mockResolvedValue(null);
  expect(await getServerSession()).toBeNull();
});
