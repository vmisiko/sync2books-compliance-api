# Go-live evidence — Gear Train Engineering Limited, 2026-09-18

Second go-live application, a separate KRA app/PIN from the 2026-09-17 SYNC TO BOOKS RECONCILER LIMITED run.

- Taxpayer: Gear Train Engineering Limited, PIN `P600004575A`, branch `00` (Headquarter, Ngong, Kajiado East District, Kajiado)
- Integrator: THIRDPARTY, integrator PIN `P052346401U`, device `SYNCP052346401U`, SCU ID `KRACU0400001238`
- Apigee app `8cd346af-5d28-48bb-940b-caefd504b6db`; KRA sandbox

Catalogue: 15 IT items — 6 stocked goods (PDQ terminal, thermal printer, barcode scanner, network switch,
solar POS terminal, thermal paper rolls) and 9 non-stock services (eTIMS installation, ERP integration,
support contract, endpoint licence, cloud backup, training, offshore development, payment-gateway onboarding,
statutory filing disbursement). Tax bands B 16%, A exempt, C zero-rated, D non-VAT.

| File | CU invoice no. | TOTAL (KES) | Shows |
|---|---|---|---|
| `invoice-copy.pdf` (= INV-260918-03 COPY) | KRACU0400001238/3 | 170,200.00 | goods + services, bands B and D, bank cheque, buyer PIN |
| `credit-note-copy.pdf` (= CN-260918-01 COPY) | KRACU0400001238/8 | −54,200.00 | partial credit of one goods and one service line against /3 |
| INV-260918-01 | /1 | 104,400.00 | single band B |
| INV-260918-02 | /2 | 351,760.00 | B + A (exempt) + C (zero-rated) on one invoice |
| INV-260918-04 | /4 | 100,920.00 | services only (non-stock), M-Pesa |
| INV-260918-05 | /5 | 250,000.00 | zero-rated only |
| INV-260918-06 | /6 | 15,000.00 | exempt only, cash |
| INV-260918-07 | /7 | 24,940.00 | walk-in consumer, no buyer PIN, card |

Each document has both an original (`<number>.pdf`) and a COPY (`<number>-COPY.pdf`). Receipts /3 and /8 were
verified on `etims-sbx.kra.go.ke` — invoice number, client name and PIN match the PDFs.

All KRA test-case endpoints returned `resultCd 000` (or `001` "no search result" for the stock-movement
lookup, a valid empty result). Raw responses in `api-responses/`.

Open template items: official KRA logo (placeholder box), no discount lines.
