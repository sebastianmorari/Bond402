import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{12,}\b/,
  /\b(?:ghp|github_pat|xox[abprs])-[A-Za-z0-9_-]{16,}\b/,
  /\bAIza[A-Za-z0-9_-]{30,}\b/,
  /\bpostgres(?:ql)?:\/\/[^/\s:@]+:[^/\s@]+@/i,
];

function extension(path) {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

test("tracked text files contain no high-confidence secret patterns", () => {
  const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((path) => path && TEXT_EXTENSIONS.has(extension(path)));
  const findings = [];

  for (const path of paths) {
    const content = readFileSync(path, "utf8");
    if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) findings.push(path);
  }

  assert.deepEqual(
    findings,
    [],
    "Mögliche Secrets wurden erkannt; Werte werden aus Sicherheitsgründen nicht ausgegeben.",
  );
});