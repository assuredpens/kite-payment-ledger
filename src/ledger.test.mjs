import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "./store.mjs";
import { Ledger } from "./ledger.mjs";
function setup(t) {
  const d = mkdtempSync(join(tmpdir(), "ledger-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return new Ledger(new Vault(d, randomBytes(32).toString("hex")));
}
const event = (id, more = {}) => ({
  event_id: id,
  occurred_at: "2026-10-18T00:00:00Z",
  ...more,
});
test("strong receipt matches buyer and merchant, response loss yields recovery", async (t) => {
  const l = setup(t);
  await l.import("a", "merchant", [
    event("s", {
      operation_id: "op-1",
      receipt_ref: "r1",
      payment_state: "CONFIRMED",
      fulfillment_state: "READY",
      artifact_hash: "h",
    }),
  ]);
  const r = await l.import("a", "buyer", [
    event("b", { receipt_ref: "r1", http_status: 200 }),
  ]);
  assert.equal(r.operations.length, 1);
  assert.equal(r.operations[0].payment_state, "CONFIRMED");
  assert(r.operations[0].issues.includes("recover_original_artifact"));
});
test("same amount never confirms a link; missing evidence stays unknown", async (t) => {
  const l = setup(t);
  const r = await l.import("a", "activity", [
    event("1", { amount_base_units: "100", asset: "a", network: "n" }),
    event("2", { amount_base_units: "100", asset: "a", network: "n" }),
  ]);
  assert.equal(r.operations.length, 2);
  assert.equal(r.candidates.length, 1);
  assert(r.operations.every((o) => o.payment_state === "UNKNOWN"));
});
test("deduplication is atomic and conflicting event does not alter history", async (t) => {
  const l = setup(t);
  const e = event("1", { operation_id: "op" });
  await l.import("a", "merchant", [e]);
  assert.equal((await l.import("a", "merchant", [e, e])).duplicates, 2);
  await assert.rejects(
    l.import("a", "merchant", [event("2"), { ...e, operation_id: "changed" }]),
    { code: "event_conflict" },
  );
  assert.equal(l.view("a").operations.length, 1);
  assert.equal(l.view("a").history_count, 2);
});
test("tenant isolation and sensitive fields stripped before persistence", async (t) => {
  const l = setup(t);
  await l.import("a", "merchant", [
    event("one", {
      operation_id: "op",
      signature: "s",
      token: "t",
      session_id: "session",
    }),
  ]);
  assert.equal(l.view("b").operations.length, 0);
  const e = l.view("a").operations[0].events[0];
  assert(!e.signature && !e.token && !e.session_id);
});
test("late evidence appends decisions and manual resolution never transfers", async (t) => {
  const l = setup(t);
  await l.import("a", "merchant", [event("one", { operation_id: "op" })]);
  await l.import("a", "buyer", [
    event("two", {
      operation_id: "op",
      receipt_ref: "r",
      payment_state: "CONFIRMED",
      fulfillment_state: "FAILED",
    }),
  ]);
  assert.equal(l.view("a").history_count, 2);
  const r = await l.resolve(
    "a",
    "op",
    "manual_refund_pending",
    "Customer requests review",
  );
  assert.equal(r.executes_payment, false);
  assert.equal(l.view("a").resolutions.length, 1);
  await assert.rejects(
    l.resolve("b", "op", "manual_refund_pending", "Customer requests review"),
    { code: "operation_not_found" },
  );
});
test("contradictory settlement evidence remains unknown", async (t) => {
  const l = setup(t);
  await l.import("a", "merchant", [
    event("a", {
      operation_id: "o",
      receipt_ref: "r",
      payment_state: "CONFIRMED",
    }),
    event("b", {
      operation_id: "o",
      failure_evidence: "rejected",
      payment_state: "FAILED",
    }),
  ]);
  assert.equal(l.view("a").operations[0].payment_state, "UNKNOWN");
});
test("same artifact or receipt never shares settlement across distinct orders", async (t) => {
  const l = setup(t);
  const r = await l.import("a", "merchant", [
    event("a", {
      operation_id: "order-a",
      artifact_hash: "identical-output",
      receipt_ref: "batch-receipt",
      payment_state: "CONFIRMED",
    }),
    event("b", {
      operation_id: "order-b",
      artifact_hash: "identical-output",
      receipt_ref: "batch-receipt",
      fulfillment_state: "READY",
    }),
  ]);
  assert.equal(r.operations.length, 2);
  assert.equal(
    r.operations.find((x) => x.id === "order-b").payment_state,
    "UNKNOWN",
  );
  assert(
    r.candidates.some((x) => x.reason === "shared_artifact_not_confirmed"),
  );
});
test("request and transaction references are scoped by merchant and network", async (t) => {
  const l = setup(t);
  const r = await l.import("a", "merchant", [
    event("a", {
      operation_id: "same",
      network: "eip155:2368",
      merchant_origin: "https://a.example",
      transaction_refs: ["0xabc"],
      payment_state: "CONFIRMED",
    }),
    event("b", {
      operation_id: "same",
      network: "eip155:2366",
      merchant_origin: "https://a.example",
      transaction_refs: ["0xabc"],
      fulfillment_state: "READY",
    }),
    event("c", {
      operation_id: "same",
      network: "eip155:2368",
      merchant_origin: "https://b.example",
      transaction_refs: ["0xabc"],
      fulfillment_state: "READY",
    }),
  ]);
  assert.equal(r.operations.length, 3);
  assert.equal(
    r.operations.filter((x) => x.payment_state === "CONFIRMED").length,
    1,
  );
});
