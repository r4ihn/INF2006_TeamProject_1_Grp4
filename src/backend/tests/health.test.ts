// Import statements
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

//  Check server health test
// Will return a check on test FileSystemDirectoryReader, GET /health and returns 200
describe("GET /health", () => {
    it("returns 200", async () => {
        const res = await request(createApp()).get("/health");
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: "ok" });
    });
});