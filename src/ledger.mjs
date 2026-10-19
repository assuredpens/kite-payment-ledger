import { randomUUID } from "node:crypto";
import { audit, clean, fault, hash } from "./store.mjs";
const paidStates = new Set([
  "NOT_ATTEMPTED",
  "PENDING",
  "CONFIRMED",
  "UNKNOWN",
  "FAILED",
]);
const deliveryStates = new Set([
  "NOT_STARTED",
  "RUNNING",
  "READY",
  "SENT",
  "ACCESSED",
  "FAILED",
]);
export class Ledger {
  constructor(vault) {
    this.vault = vault;
  }
  async import(tenant, source, events) {
    if (!Array.isArray(events) || events.length > 2000)
      throw fault("invalid_import");
    return this.vault.transaction((s, save) => {
      s.tenants ??= {};
      const t = (s.tenants[tenant] ??= {
        events: [],
        decisions: [],
        resolutions: [],
      });
      let inserted = 0,
        duplicates = 0;
      // Validate full batch before changing state, including duplicate IDs inside one batch.
      const pending = new Map();
      for (const raw of events) {
        const e = clean(raw);
        if (
          !e.event_id ||
          !e.occurred_at ||
          Number.isNaN(Date.parse(e.occurred_at))
        )
          throw fault("event_id_and_timestamp_required");
        if (
          (e.payment_state && !paidStates.has(e.payment_state)) ||
          (e.fulfillment_state && !deliveryStates.has(e.fulfillment_state))
        )
          throw fault("invalid_state");
        if (
          e.amount_base_units !== undefined &&
          !/^\d+$/.test(e.amount_base_units)
        )
          throw fault("integer_units_required");
        e.evidence_source = source;
        e.observed_at = new Date().toISOString();
        e.schema_version = 1;
        const old =
          t.events.find((x) => x.event_id === e.event_id) ||
          pending.get(e.event_id);
        if (old) {
          const a = { ...old },
            b = { ...e };
          delete a.observed_at;
          delete b.observed_at;
          if (hash(a) !== hash(b)) throw fault("event_conflict", 409);
          duplicates++;
        } else {
          pending.set(e.event_id, e);
          inserted++;
        }
      }
      t.events.push(...pending.values());
      audit(s, "import", { tenant, source, inserted, duplicates });
      const snapshot = this.viewTenant(t);
      t.decisions.push({
        decision_id: randomUUID(),
        observed_at: new Date().toISOString(),
        operations: snapshot.operations,
      });
      save();
      return { inserted, duplicates, ...snapshot };
    });
  }
  viewTenant(t) {
    const events = t.events,
      parents = events.map((_, i) => i),
      refs = new Map();
    const find = (x) =>
      parents[x] === x ? x : (parents[x] = find(parents[x]));
    const keys = (e) => [
      ...["operation_id", "merchant_request_id", "receipt_ref", "artifact_hash"]
        .filter((k) => e[k])
        .map((k) => k + ":" + e[k]),
      ...(e.transaction_refs || [])
        .filter(Boolean)
        .map((v) => "transaction:" + v),
    ];
    events.forEach((e, i) => {
      for (const k of keys(e)) {
        if (refs.has(k)) parents[find(i)] = find(refs.get(k));
        else refs.set(k, i);
      }
    });
    const groups = new Map();
    events.forEach((e, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(e);
    });
    const operations = [...groups.values()].map((group) => {
      group.sort(
        (a, b) =>
          Date.parse(a.occurred_at) - Date.parse(b.occurred_at) ||
          a.event_id.localeCompare(b.event_id),
      );
      const opIds = [
        ...new Set(group.map((e) => e.operation_id).filter(Boolean)),
      ];
      const transactions = [
        ...new Set(group.flatMap((e) => e.transaction_refs || [])),
      ];
      // Never use an HTTP code, quote, wallet balance or time similarity as settlement proof.
      const confirmed = group.some(
        (e) =>
          e.payment_state === "CONFIRMED" &&
          (e.receipt_ref || e.transaction_refs?.length),
      );
      const failed = group.some(
        (e) =>
          e.payment_state === "FAILED" && (e.receipt_ref || e.failure_evidence),
      );
      let payment = confirmed
        ? "CONFIRMED"
        : failed
          ? "FAILED"
          : group.some((e) => e.payment_state === "PENDING")
            ? "PENDING"
            : "UNKNOWN";
      if (confirmed && failed) payment = "UNKNOWN";
      const fulfilled = group.filter((e) => e.fulfillment_state);
      let fulfillment = fulfilled.at(-1)?.fulfillment_state || "NOT_STARTED";
      const partial = group.some((e) => e.partial_delivery === true);
      const issues = [];
      if (confirmed && failed) issues.push("contradictory_payment_evidence");
      if (opIds.length > 1)
        issues.push("multiple_business_operations_share_evidence");
      if (partial) issues.push("partial_delivery");
      if (payment === "UNKNOWN")
        issues.push("payment_evidence_missing_or_unknown");
      if (payment === "CONFIRMED" && fulfillment === "FAILED")
        issues.push("paid_unfulfilled_manual_review");
      if (payment === "CONFIRMED" && fulfillment === "READY")
        issues.push("recover_original_artifact");
      if (payment === "CONFIRMED" && fulfillment === "RUNNING")
        issues.push("resume_original_job");
      return {
        id: opIds[0] || "unlinked-" + group[0].event_id,
        operation_ids: opIds,
        payment_state: payment,
        fulfillment_state: fulfillment,
        transactions,
        issues,
        sources: [...new Set(group.map((e) => e.evidence_source))],
        events: group,
      };
    });
    const candidates = [];
    for (let i = 0; i < operations.length; i++)
      for (let j = i + 1; j < operations.length; j++) {
        const a = operations[i],
          b = operations[j];
        if (
          a.events.some((x) =>
            b.events.some(
              (y) =>
                x.asset &&
                x.asset === y.asset &&
                x.network === y.network &&
                x.amount_base_units &&
                x.amount_base_units === y.amount_base_units,
            ),
          )
        )
          candidates.push({
            left: a.id,
            right: b.id,
            reason: "amount_only_not_confirmed",
          });
      }
    return {
      operations,
      candidates,
      resolutions: t.resolutions,
      history_count: t.decisions.length,
    };
  }
  view(tenant) {
    return this.viewTenant(
      this.vault.read().tenants?.[tenant] || {
        events: [],
        decisions: [],
        resolutions: [],
      },
    );
  }
  async resolve(tenant, operation_id, action, reason, evidence) {
    if (
      ![
        "recover_result",
        "wait_for_evidence",
        "contact_merchant",
        "manual_refund_pending",
        "record_refund_receipt",
      ].includes(action) ||
      typeof reason !== "string" ||
      reason.length < 8
    )
      throw fault("resolution_reason_required");
    if (action === "record_refund_receipt" && !evidence?.receipt_ref)
      throw fault("refund_receipt_required");
    return this.vault.transaction((s, save) => {
      const t = s.tenants?.[tenant];
      if (
        !t ||
        !this.viewTenant(t).operations.some((o) => o.id === operation_id)
      )
        throw fault("operation_not_found", 404);
      const resolution = {
        id: randomUUID(),
        operation_id,
        action,
        reason,
        evidence: clean(evidence || {}),
        observed_at: new Date().toISOString(),
        actor: tenant,
        executes_payment: false,
      };
      t.resolutions.push(resolution);
      audit(s, "case_resolution", { tenant, operation_id, action });
      save();
      return resolution;
    });
  }
}
