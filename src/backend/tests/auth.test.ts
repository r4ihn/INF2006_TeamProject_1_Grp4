import { SignJWT } from "jose";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { loadAuthConfig } from "../src/auth/config.js";
import { mintLocalToken } from "../src/auth/localTokens.js";
import {
  app,
  as,
  authConfig,
  db,
  logs,
  MILK,
  onHand,
  receive,
  resetDb,
  tokens,
} from "./helpers.js";

if (authConfig.mode !== "local") throw new Error("tests need AUTH_MODE=local");
const local = authConfig;

beforeEach(async () => {
  await resetDb();
  logs.length = 0;
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const sale = { productId: MILK, movementType: "SELL", quantity: 1 };

// Test 2 (security control): unauthenticated and unauthorised requests are rejected.
// Threat defended: unauthenticated or unauthorised write access to the stock ledger.
describe("authentication", () => {
  it("leaves only /health open", async () => {
    expect((await request(app).get("/health")).status).toBe(200);
  });

  const protectedRoutes: [string, string][] = [
    ["GET", "/stock"],
    ["GET", "/products"],
    ["GET", "/products/1"],
    ["GET", "/products/1/batches"],
    ["GET", "/suppliers"],
    ["GET", "/movements"],
    ["POST", "/movements"],
    ["GET", "/no-such-route"],
  ];

  it.each(protectedRoutes)(
    "%s %s without a token is 401",
    async (method, path) => {
      const res = await request(app)
        [method === "GET" ? "get" : "post"](path)
        .send(sale);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("UNAUTHENTICATED");
      expect(res.headers["www-authenticate"]).toBe("Bearer");
    }
  );

  it("an unauthenticated write does not reach the ledger", async () => {
    await receive(MILK, 100);
    const res = await request(app).post("/movements").send(sale);
    expect(res.status).toBe(401);
    expect(await onHand(MILK)).toBe(100);
  });

  it("rejects tokens that are malformed, forged or from the wrong issuer", async () => {
    const good = tokens.manager;
    const wrongSecret = await new SignJWT({
      "cognito:groups": ["manager"],
      token_use: "access",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("mallory")
      .setIssuer(local.issuer)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-completely-different-secret-value!!"));
    const wrongIssuer = await new SignJWT({
      "cognito:groups": ["manager"],
      token_use: "access",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("mallory")
      .setIssuer("someone-else")
      .setExpirationTime("1h")
      .sign(local.secret);
    const idToken = await new SignJWT({
      "cognito:groups": ["manager"],
      token_use: "id",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("mallory")
      .setIssuer(local.issuer)
      .setExpirationTime("1h")
      .sign(local.secret);
    const [header, payload] = good.split(".");
    const noneHeader = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" })
    ).toString("base64url");

    const bad = [
      "garbage",
      "a.b.c",
      wrongSecret,
      wrongIssuer,
      idToken,
      `${noneHeader}.${payload}.`, // alg=none: signature stripped
      `${header}.${payload}.`, // signature removed
      good.slice(0, -4) + "AAAA", // signature tampered
    ];
    for (const token of bad) {
      const res = await request(app).get("/stock").set(bearer(token));
      expect(res.status, token.slice(0, 20)).toBe(401);
    }
  });

  it("rejects an expired token with a distinct code", async () => {
    const expired = await mintLocalToken(local, {
      role: "manager",
      ttlSeconds: -60,
    });
    const res = await request(app).get("/stock").set(bearer(expired));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("TOKEN_EXPIRED");
  });

  it("rejects a valid token with no role as 403", async () => {
    const noRole = await mintLocalToken(local, { role: "staff", groups: [] });
    const other = await mintLocalToken(local, {
      role: "staff",
      groups: ["guest"],
    });
    for (const token of [noRole, other]) {
      const res = await request(app).get("/stock").set(bearer(token));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("NO_ROLE");
    }
  });

  it("rejects non-bearer authorization schemes", async () => {
    const res = await request(app)
      .get("/stock")
      .set("Authorization", `Basic ${tokens.manager}`);
    expect(res.status).toBe(401);
  });
});

describe("authorization by role", () => {
  it("staff can read and record receipts and sales", async () => {
    expect((await as("staff").get("/stock")).status).toBe(200);
    expect((await as("staff").get("/movements")).status).toBe(200);
    const receipt = await as("staff")
      .post("/movements")
      .send({ productId: MILK, movementType: "RECEIVE", quantity: 100 });
    expect(receipt.status).toBe(201);
    expect((await as("staff").post("/movements").send(sale)).status).toBe(201);
  });

  it.each(["SPOILAGE", "ADJUST"] as const)(
    "staff cannot record %s; managers can",
    async (type) => {
      const batch = await receive(MILK, 100, "2099-01-01");
      const body = {
        productId: MILK,
        movementType: type,
        quantity: type === "ADJUST" ? -5 : 5,
        batchId: batch,
        reason: "test",
      };

      const denied = await as("staff").post("/movements").send(body);
      expect(denied.status).toBe(403);
      expect(denied.body.error).toBe("FORBIDDEN");
      expect(await onHand(MILK)).toBe(100);

      const allowed = await as("manager").post("/movements").send(body);
      expect(allowed.status).toBe(201);
      expect(await onHand(MILK)).toBe(95);
    }
  );

  it("records who made each movement", async () => {
    const res = await as("staff")
      .post("/movements")
      .send({ productId: MILK, movementType: "RECEIVE", quantity: 10 });
    expect(res.body.movements[0].recordedBy).toBe("test-staff");
    const { rows } = await db().query(
      "SELECT recorded_by FROM stock_movements"
    );
    expect(rows).toEqual([{ recorded_by: "test-staff" }]);
  });
});

describe("audit logging", () => {
  it("logs failed authentication and denied actions without leaking credentials", async () => {
    await request(app).get("/stock");
    await request(app).get("/stock").set(bearer("garbage"));
    const batch = await receive(MILK, 10, "2099-01-01");
    await as("staff").post("/movements").send({
      productId: MILK,
      movementType: "SPOILAGE",
      quantity: 1,
      batchId: batch,
      reason: "x",
    });

    const failures = logs
      .filter((l) => l.event === "auth_failed")
      .map((l) => l.fields.reason);
    expect(failures).toEqual(["missing_token", "invalid_token"]);
    const denied = logs.find((l) => l.event === "authz_denied");
    expect(denied?.fields).toMatchObject({
      user: "test-staff",
      role: "staff",
      required: "manager",
    });

    const everything = JSON.stringify(logs);
    expect(everything).not.toContain("garbage");
    expect(everything).not.toContain(tokens.staff);
    expect(everything).not.toContain(tokens.manager);
    expect(logs.filter((l) => l.event === "request").length).toBeGreaterThan(0);
  });

  it("puts a request id on every response", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("auth configuration", () => {
  const secret = "x".repeat(32);

  it("fails closed: refuses to start without an explicit AUTH_MODE", () => {
    expect(() => loadAuthConfig({})).toThrow(/AUTH_MODE/);
    expect(() => loadAuthConfig({ AUTH_MODE: "off" })).toThrow(/AUTH_MODE/);
  });

  it("refuses a short local secret, and local mode in production", () => {
    expect(() =>
      loadAuthConfig({ AUTH_MODE: "local", AUTH_LOCAL_SECRET: "short" })
    ).toThrow(/32/);
    expect(() =>
      loadAuthConfig({
        AUTH_MODE: "local",
        AUTH_LOCAL_SECRET: secret,
        NODE_ENV: "production",
      })
    ).toThrow(/production/);
  });

  it("needs all Cognito settings", () => {
    expect(() =>
      loadAuthConfig({ AUTH_MODE: "cognito", COGNITO_REGION: "us-east-1" })
    ).toThrow(/COGNITO/);
    expect(
      loadAuthConfig({
        AUTH_MODE: "cognito",
        COGNITO_REGION: "us-east-1",
        COGNITO_USER_POOL_ID: "us-east-1_abc",
        COGNITO_CLIENT_ID: "client",
      }).mode
    ).toBe("cognito");
  });
});
