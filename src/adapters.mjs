import { fault, hash } from "./store.mjs";
const origin = (value) => {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    throw fault("invalid_merchant_origin");
  }
};
const base = (raw, fields) =>
  JSON.parse(
    JSON.stringify({
      ...fields,
      original_digest: hash(raw),
      proof_validation: "imported_claim_not_chain_verified",
    }),
  );
export function normalize(source, payload, context = {}) {
  const merchant = origin(context.merchant_origin);
  if (source === "passport-activity") {
    if (!Array.isArray(payload.events)) throw fault("passport_events_required");
    return payload.events
      .filter((e) => e.kind === "x402_payment")
      .map((e) => {
        const tx = e.details?.transaction || {},
          x = tx.x402 || {};
        if (!e.id || !e.occurred_at) throw fault("activity_identity_required");
        return base(e, {
          event_id: "passport:" + e.id,
          occurred_at: e.occurred_at,
          operation_id: x.operation_id,
          network: Number.isSafeInteger(tx.chain_id)
            ? "eip155:" + tx.chain_id
            : tx.chain_name || "unknown",
          merchant_origin: origin(x.request_url) || merchant,
          payer: tx.source_address?.toLowerCase(),
          asset: tx.asset_address?.toLowerCase(),
          asset_symbol: tx.asset_symbol,
          amount_base_units: tx.amount_raw,
          transaction_refs: tx.tx_hash ? [tx.tx_hash] : [],
          payment_state:
            e.status === "completed" && tx.tx_hash
              ? "CONFIRMED"
              : e.status === "failed"
                ? "FAILED"
                : "UNKNOWN",
          failure_evidence:
            e.status === "failed"
              ? e.error_code || "passport_activity_failed"
              : undefined,
        });
      });
  }
  if (source === "seller-journal") {
    if (!payload.payments || typeof payload.payments !== "object")
      throw fault("seller_payments_required");
    return Object.entries(payload.payments).map(([id, r]) =>
      base(r, {
        event_id:
          "seller:" +
          id +
          ":" +
          hash({
            payment: r.payment_state,
            fulfillment: r.fulfillment_state,
            receipt: r.receipt,
          }).slice(0, 16),
        occurred_at: r.updated_at || context.occurred_at || r.created_at,
        operation_id: id,
        network: r.network,
        merchant_origin: merchant,
        payer: r.payer?.toLowerCase(),
        asset: r.asset?.toLowerCase(),
        amount_base_units: r.amount_base_units,
        transaction_refs: r.receipt?.transaction ? [r.receipt.transaction] : [],
        payment_state: ["CONFIRMED", "FAILED", "UNKNOWN"].includes(
          r.payment_state,
        )
          ? r.payment_state
          : "PENDING",
        fulfillment_state: r.fulfillment_state,
        artifact_hash: r.result?.content_hash || r.result?.artifact_hash,
      }),
    );
  }
  if (source === "facilitator-receipt") {
    if (!context.occurred_at || !payload.network || !payload.transaction)
      throw fault("receipt_context_required");
    return [
      base(payload, {
        event_id: "receipt:" + hash(payload),
        occurred_at: context.occurred_at,
        operation_id: context.operation_id,
        network: payload.network,
        merchant_origin: merchant,
        payer: context.payer?.toLowerCase(),
        transaction_refs: [payload.transaction],
        payment_state: payload.success === true ? "CONFIRMED" : "UNKNOWN",
      }),
    ];
  }
  throw fault("unsupported_import_adapter");
}
