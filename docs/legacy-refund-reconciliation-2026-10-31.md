# Legacy refund reconciliation evidence - 31 October 2026

Initial read-only inspection, followed by user-authorized cleanup: the user confirmed all four records were development test data. Exactly four refunds were removed on 31 October 2026. Recovery copies are retained in `development_refund_removal_backups`. No linked pending notices existed. Unrelated bookings and refunds were left intact. The table below preserves the pre-cleanup evidence.
All amounts below are NGN major units (the database stores minor units).

| Refund ID | Recorded refund | Checkout ticket subtotal | Difference | Recorded status | Tickets |
| --- | ---: | ---: | ---: | --- | ---: |
| 6ac8f2d8c62c7354386f55e8 | 11,000 | 10,000 | 1,000 | CONFIRMED_BY_BUYER | 1 |
| 6ac8f2d9c62c7354386f55f3 | 33,000 | 30,000 | 3,000 | MARKED_PAID | 2 |
| 6ac8f2dac62c7354386f5602 | 11,000 | 10,000 | 1,000 | CONFIRMED_BY_BUYER | 1 |
| 6ac8f2dbc62c7354386f560d | 33,000 | 30,000 | 3,000 | MARKED_PAID | 2 |

The recorded amounts equal the fee-inclusive checkout totals. The current policy calculates ticket-only refunds. All four have a marked-paid timestamp; two have recipient confirmation. No uploaded receipt timestamp was recorded. Current ticket holders still match the recorded recipients.

The difference totals NGN 8,000. It is not evidence of an unpaid balance or an overpayment: actual bank transfer evidence and the terms applying to these historical settlements must be checked first. The two multi-ticket records also require allocation of settlement evidence before migration. Do not reduce a settled historical amount to make a migration pass.

Regenerate the evidence using `node scripts/reportLegacyRefunds.js`. The script is read-only and excludes bank details and customer contact information. After the operator supplies settlement evidence and the intended historical fee policy, prepare an audited migration that preserves the original records and amounts.
