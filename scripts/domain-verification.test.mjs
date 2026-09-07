import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import https from "node:https";
import { test, before, after } from "node:test";
import {
  hashDomainVerificationToken,
  verifyDomainChallenge,
} from "../artifacts/api-server/src/lib/api-verifier.ts";

const fixtureToken = "bond402_fixture_valid";
const fixtureWrongToken = "bond402_fixture_wrong";
let fixtureServer;
let fixtureUrl;
let fixtureDirectory;
let fixtureRequests = 0;

async function startHttpsFixture() {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "bond402-domain-verification-"));
  const keyPath = join(fixtureDirectory, "key.pem");
  const certificatePath = join(fixtureDirectory, "certificate.pem");

  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-keyout",
      keyPath,
      "-out",
      certificatePath,
    ],
    { stdio: "ignore" },
  );

  const [key, cert] = await Promise.all([readFile(keyPath), readFile(certificatePath)]);
  fixtureServer = https.createServer({ key, cert }, (req, res) => {
    if (req.url !== "/.well-known/bond402-verification.txt") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(fixtureToken);
  });
  fixtureServer.listen(0, "127.0.0.1");
  await once(fixtureServer, "listening");
  const address = fixtureServer.address();
  assert.ok(address && typeof address === "object");
  fixtureUrl = `https://127.0.0.1:${address.port}/`;
}

async function fixtureFetch(url) {
  fixtureRequests += 1;
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        rejectUnauthorized: false,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

before(async () => {
  await startHttpsFixture();
});

after(async () => {
  if (fixtureServer) {
    fixtureServer.close();
    await once(fixtureServer, "close").catch(() => {});
  }
  if (fixtureDirectory) {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test("Domain-Verifizierung akzeptiert nur den passenden HTTPS-Well-Known-Token", async () => {
  const expectedHash = hashDomainVerificationToken(fixtureToken);
  const accepted = await verifyDomainChallenge(fixtureUrl, expectedHash, fixtureFetch);
  assert.equal(accepted.verified, true);
  assert.match(accepted.reason, /HTTPS-Well-Known-Datei/);

  const rejectedToken = await verifyDomainChallenge(
    fixtureUrl,
    createHash("sha256").update(fixtureWrongToken, "utf8").digest("hex"),
    fixtureFetch,
  );
  assert.equal(rejectedToken.verified, false);
  assert.match(rejectedToken.reason, /stimmt nicht überein/);

  const requestsBeforeHttp = fixtureRequests;
  const rejectedHttp = await verifyDomainChallenge(
    fixtureUrl.replace(/^https:/, "http:"),
    expectedHash,
    fixtureFetch,
  );
  assert.equal(rejectedHttp.verified, false);
  assert.match(rejectedHttp.reason, /benötigt HTTPS/);
  assert.equal(fixtureRequests, requestsBeforeHttp);
});