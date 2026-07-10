import { afterEach, describe, expect, it } from "vitest";
import { TokenService } from "../src/modules/identity/token.service";
const originalNodeEnv = process.env.NODE_ENV,
  originalSecret = process.env.JWT_SECRET;
afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});
describe("production token configuration", () => {
  it("fails fast for a missing production secret", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    expect(() => new TokenService()).toThrow(/JWT_SECRET/);
  });
  it("fails fast for a low-entropy production secret", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(() => new TokenService()).toThrow(/JWT_SECRET/);
  });
  it("accepts a sufficiently diverse production secret", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "A9!b8@C7#d6$E5%f4^G3&h2*J1(k0)L_";
    expect(() => new TokenService()).not.toThrow();
  });
});
