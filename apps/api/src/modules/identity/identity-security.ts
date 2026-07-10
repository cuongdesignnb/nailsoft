import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function normalizePhone(input: string): string {
  let value = input.trim().replace(/[\s().-]/g, "");
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (value.startsWith("0")) value = `+84${value.slice(1)}`;
  if (!/^\+[1-9][0-9]{7,14}$/.test(value)) throw new Error("PHONE_INVALID");
  return value;
}

export function assertPasswordPolicy(password: string, identifiers: string[] = []) {
  if (password.length < 10 || password.length > 128)
    throw new Error("PASSWORD_POLICY_INVALID");
  if (!/[\p{L}]/u.test(password) || !/[^\p{L}]/u.test(password))
    throw new Error("PASSWORD_POLICY_INVALID");
  const folded = password.toLocaleLowerCase();
  if (identifiers.some((value) => value && folded === value.toLocaleLowerCase()))
    throw new Error("PASSWORD_POLICY_INVALID");
}

export function secretHash(value: string, context = "identity") {
  return createHmac("sha256", process.env.IDENTITY_HASH_SECRET ?? process.env.JWT_SECRET ?? "development-identity-hash-secret")
    .update(`${context}:${value}`)
    .digest("hex");
}

function encryptionKey() {
  return createHash("sha256")
    .update(process.env.MFA_ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? "development-mfa-encryption-key")
    .digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(value: string) {
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("MFA_SECRET_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(input: Buffer) {
  let bits = "";
  for (const byte of input) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let offset = 0; offset < bits.length; offset += 5) {
    const chunk = bits.slice(offset, offset + 5).padEnd(5, "0");
    output += base32Alphabet[Number.parseInt(chunk, 2)];
  }
  return output;
}

function base32Decode(input: string) {
  let bits = "";
  for (const character of input.replace(/=+$/g, "").toUpperCase()) {
    const index = base32Alphabet.indexOf(character);
    if (index < 0) throw new Error("MFA_SECRET_INVALID");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8)
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totp(secret: string, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return number.toString().padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, timestamp = Date.now()) {
  if (!/^[0-9]{6}$/.test(code)) return false;
  return [-1, 0, 1].some((window) => {
    const expected = Buffer.from(totp(secret, timestamp + window * 30_000));
    const actual = Buffer.from(code);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  });
}

export interface OtpProvider {
  send(input: { destination: string; code: string; locale: string; purpose: string }): Promise<{ providerMessageId?: string }>;
}

export class ControlledFakeOtpProvider implements OtpProvider {
  async send(input: { destination: string; code: string; locale: string; purpose: string }) {
    void input;
    return { providerMessageId: `fake-${randomBytes(8).toString("hex")}` };
  }
}
