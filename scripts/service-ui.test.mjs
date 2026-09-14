import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  isDomainVerificationNotApplicableError,
  shouldShowDomainVerification,
} from "../artifacts/bond402/src/lib/service-ui.ts";

test("Drittanbieter erhalten keinen Domain-Verifizierungsbereich", () => {
  assert.equal(shouldShowDomainVerification("THIRD_PARTY"), false);
  assert.equal(shouldShowDomainVerification(null), false);
  assert.equal(shouldShowDomainVerification("OWNED"), true);
});

test("DOMAIN_VERIFICATION_NOT_APPLICABLE ist im alten Client kein roter Fehler", () => {
  assert.equal(
    isDomainVerificationNotApplicableError({
      data: {
        code: "DOMAIN_VERIFICATION_NOT_APPLICABLE",
      },
    }),
    true,
  );
  assert.equal(
    isDomainVerificationNotApplicableError({
      data: {
        code: "VERIFICATION_NOT_STARTED",
      },
    }),
    false,
  );
});

test("Katalogfehler zeigen keinen normalen Leerzustand", () => {
  const source = readFileSync(
    new URL("../artifacts/bond402/src/pages/public-catalog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /role="alert"/);
  assert.match(source, /Erneut versuchen/);
  assert.match(source, /error \? null : data\?\.items\.length/);
});