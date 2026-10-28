import test from "node:test";
import assert from "node:assert/strict";
import { normalize } from "./adapters.mjs";
test("Passport Activity and own seller receipts preserve shared chain evidence without storing signatures", () => {
  const tx = "0x" + "1".repeat(64),
    payer = "0x" + "a".repeat(40),
    at = "2026-10-28T00:00:00Z";
  const activity = normalize("passport-activity", {
    events: [
      {
        id: "a",
        kind: "x402_payment",
        status: "completed",
        occurred_at: at,
        details: {
          transaction: {
            chain_id: 2368,
            source_address: payer,
            amount_raw: "10000",
            tx_hash: tx,
            x402: { request_url: "https://seller.example/v1/query" },
          },
        },
      },
      { kind: "wallet_transfer" },
    ],
  });
  const receipt = normalize(
    "facilitator-receipt",
    { success: true, network: "eip155:2368", transaction: tx },
    { payer, merchant_origin: "https://seller.example", occurred_at: at },
  );
  assert.equal(activity.length, 1);
  assert.equal(activity[0].network, receipt[0].network);
  assert.equal(activity[0].merchant_origin, receipt[0].merchant_origin);
  assert.deepEqual(activity[0].transaction_refs, receipt[0].transaction_refs);
  assert.equal(
    activity[0].proof_validation,
    "imported_claim_not_chain_verified",
  );
  const events = normalize(
    "seller-journal",
    {
      payments: {
        op: {
          created_at: at,
          payer,
          network: "eip155:2368",
          receipt: { transaction: tx },
          payment_state: "CONFIRMED",
          fulfillment_state: "READY",
          signature: "never-persist",
        },
      },
    },
    { merchant_origin: "https://seller.example" },
  );
  assert(!JSON.stringify(events).includes("never-persist"));
  assert.equal(events[0].operation_id, "op");
});
