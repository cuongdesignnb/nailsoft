import { Injectable } from "@nestjs/common";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
@Injectable()
export class PasswordService {
  async hash(password: string) {
    const salt = randomBytes(16).toString("hex");
    const key = (await scrypt(password, salt, 64)) as Buffer;
    return `scrypt$${salt}$${key.toString("hex")}`;
  }
  async verify(password: string, encoded: string) {
    const [algorithm, salt, hex] = encoded.split("$");
    if (algorithm !== "scrypt" || !salt || !hex) return false;
    const actual = (await scrypt(password, salt, 64)) as Buffer;
    const expected = Buffer.from(hex, "hex");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
