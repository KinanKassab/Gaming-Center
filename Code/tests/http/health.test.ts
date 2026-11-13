import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getLive } from "@/app/api/health/live/route";
import { GET as getReady } from "@/app/api/health/ready/route";
import { createTestEnvironment, invokeHttp } from "../helpers/identity";

async function readJson(response: Response): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body };
}

describe("health endpoints", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("liveness is public and minimal", async () => {
    const response = await getLive();
    const { status, body } = await readJson(response);
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok" });
    expect(JSON.stringify(body)).not.toMatch(/postgres|password|secret|version/i);
  });

  it("readiness succeeds against the test database and stays generic", async () => {
    const env = await createTestEnvironment();
    const response = await invokeHttp(env, { headers: new Headers() }, () => getReady());
    const { status, body } = await readJson(response);
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok" });
    expect(JSON.stringify(body).toLowerCase()).not.toContain("gaming_app");
    expect(JSON.stringify(body).toLowerCase()).not.toContain("postgres");
  });

  it("readiness is not_ready without a runtime database", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const response = await getReady();
    const { status, body } = await readJson(response);
    expect(status).toBe(503);
    expect(body).toEqual({ status: "not_ready" });
    expect(JSON.stringify(body)).not.toMatch(/postgres:\/\//i);
  });
});
