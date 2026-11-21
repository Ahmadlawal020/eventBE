# Client venue rescheduling

The venue cancellation policy has a separate `rescheduleApprovalRequired` setting, defaulting to true. It is copied into new bookings. Existing bookings keep their agreed policy; changing the listing does not rewrite them.

- Automatic: quote current venue prices for the same booked duration. Collect any outstanding difference through Paystack, including the platform fee on the positive price increase. Verify the payment server-side before moving dates.
- Approval: submit a request. The organiser reviews the current price and confirms the move. Collections and refunds are settled directly with the organiser using the existing ledger and receipt flow.
- Lower price: record a direct refund due. The customer can submit bank details before the organiser prepares a refund installment.

The original payment remains immutable. Revised totals, additional platform fees, payments and date history are recorded separately. Pending checkout retains original dates and temporarily reserves target dates. Conflicting financial changes are blocked while payment is unresolved. A successful payment that cannot be applied is returned in full through the provider, rather than moving dates.

## Deployment

Deploy the API and worker with this feature before releasing the app. In the target environment run `npm run check:worker-indexes -- --apply` to create the declared indexes, including the unique active-attempt index. This command was not run against a live database during implementation.

The existing venue-checkout worker now also verifies reschedule payments and processes failed-change payment returns. It revisits expired failed attempts for seven days to recover delayed success even without a webhook; authenticated provider webhooks and explicit verification also handle later successes. Monitor worker failures, including refunds requiring provider reconciliation. Organisers need a connected Paystack payout subaccount for automatic price increases.

Before release, exercise Paystack test-mode checkout on a device: success, cancellation, app close/reopen, delayed webhook, expiry, and provider refund. Automated tests use a mocked gateway and isolated MongoDB; they do not establish live-provider readiness.
