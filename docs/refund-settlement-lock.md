# Cancellation refund settlement lock

Implemented locally; deploy matching API and mobile versions.

Organiser flow: lock account for payment -> send the external transfer to the confirmed account -> upload receipt -> mark payment as sent. The lock has no automatic expiry. The platform records external settlement and does not send or independently verify the transfer.

`POST /api/event-refunds/:refundId/settlement/prepare` requires the bankDetailsVersion displayed by the organiser. It rejects stale versions, missing details, earlier unbound proof, paid refunds, and open holder support requests. Successful preparation returns the current account and a stable settlement.id. Lost-response retries preserve the lock and do not create another payment obligation.

Bank submission increments bankDetailsVersion and is blocked while a settlement exists. Both receipt upload methods and mark-paid require the active settlement ID and the same bank version. Direct upload preparation/completion use body.settlementId. Legacy text receipt upload uses X-Refund-Settlement-Id. Receipts, upload attempts and the payment record retain their settlement identity.

Account correction uses the existing holder support request and audited admin recovery. Staff must verify with the organiser that no transfer occurred. Recovery archives the account, receipt and settlement, increments the account version and invalidates pending uploads. Uncertain or already-sent transfers must never be reopened as unpaid.

No new index or bulk data migration is required. Old bank records without a version are treated as version 0. Existing marked-paid refunds remain confirmable/disputable. Unpaid refunds with pre-release proof require support review; do not silently bind that evidence to a new settlement. If money was already sent, preserve the evidence and resolve the case through finance rather than confirming no payment.

Require the updated organiser app before enabling this API release: old clients cannot upload new proof or mark payments sent without a settlement ID. A receipt remains evidence supplied by the organiser, not independent bank confirmation.

Validation includes concurrent bank edits and preparation, idempotent preparation, stale account/version/token rejection, proof/payment binding, notice rollback, support recovery, legacy records, mobile TypeScript and targeted lint. Device acceptance should verify lock -> external test-mode payment -> receipt -> mark-paid, holder edit denial, support recovery and network-loss retry on Android/iOS before deployment.
