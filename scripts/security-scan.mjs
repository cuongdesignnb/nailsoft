import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const findings = [];
const forbidden = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /AKIA[0-9A-Z]{16}/, /gh[pousr]_[A-Za-z0-9_]{20,}/];
for (const file of files) {
  try {
    const content = readFileSync(file, "utf8");
    for (const pattern of forbidden) if (pattern.test(content)) findings.push(`${file}: ${pattern}`);
  } catch { /* binary files are ignored */ }
}
if (findings.length) { process.stderr.write(`Potential secrets detected:\n${findings.join("\n")}\n`); process.exitCode = 1; }
else process.stdout.write(`Security scan passed: ${files.length} tracked files inspected; no private-key or token signatures found.\n`);
