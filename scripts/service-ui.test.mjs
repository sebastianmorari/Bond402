import assert from "node:assert/strict";
import { test } from "node:test";
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