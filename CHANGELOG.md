# Changes

## 0.2.0 — 2026-10-28

Import original JSON through POST /imports/passport-activity, /imports/seller-journal or /imports/facilitator-receipt with {payload, context}. Context may contain merchant_origin and payer; receipts require occurred_at. Export the restricted seller journal locally, omit secrets, and send it only to your authenticated tenant. Activity maps events[].details.transaction; it ignores non-x402 events and never converts rounded display amounts into token units. Imported claims are labelled not chain verified. Shared artifact hashes are candidates only; distinct operation IDs never lend each other payment or delivery status. Reference keys are scoped by chain, merchant and payer. Scoped operation view IDs include a stable suffix; use the returned id for case review.

This evaluation update retains explicit blocked real-payment, public-hosting and official-listing gates. Prior releases remain available.
