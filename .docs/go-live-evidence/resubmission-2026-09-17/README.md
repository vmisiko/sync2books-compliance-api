# Go-live resubmission evidence — 2026-09-17

After KRA rejected the first application on the TIS page 8 / page 10 invoice and credit-note template.

- Taxpayer: SYNC TO BOOKS RECONCILER LIMITED, PIN `P600004555A`, branch `00` (Headquarter, Jamhuri, Langata District, Nairobi)
- Integrator: THIRDPARTY, integrator PIN `P052581715V`, device `SYNCP052581715V`, SCU ID `KRACU0400001214`
- Environment: KRA sandbox

| File | CU invoice no. | TOTAL (KES) | Shows |
|---|---|---|---|
| `invoice-copy.pdf` (= INV-260917-10) | KRACU0400001214/10 | 40,636.00 | goods + services, rates B and D, bank cheque, buyer PIN |
| `credit-note-copy.pdf` (= CN-260917-02) | KRACU0400001214/15 | −3,284.00 | partial credit of one goods and one service line against /10 |
| INV-260917-08 | /8 | 12,528.00 | single rate B |
| INV-260917-09 | /9 | 10,560.00 | rates B + A (exempt) + C (zero) on one invoice |
| INV-260917-11 | /11 | 1,740.00 | service only, M-Pesa, walk-in (no buyer PIN) |
| INV-260917-12 | /12 | 3,000.00 | zero-rated only, cash |
| INV-260917-13 | /13 | 3,600.00 | exempt only, card |
| INV-260917-14 | /14 | 29,580.00 | accommodation service |

Receipts /10 and /15 were checked on `etims-sbx.kra.go.ke`: invoice number, client name and PIN, TOTAL and TAX match the PDFs.

Known open items against the template: official KRA logo (placeholder box), no discount lines (discounts not yet supported), no COPY watermark on reprints.

## Remaining test cases — 2026-09-17

All 15 rows still "Not Executed" on the dashboard were run and returned `resultCd 000`: selectCodeList (755
codes), selectNotices, saveBhfCustomer, saveBhfUser, saveBhfInsurance, selectItemList, saveItemComposition
(Dawa Cocktail ← Wild Honey 500g Jar), selectImportItemList, updateImportItem (task 20230209030827 approved),
selectTrnsPurchaseSalesList, insertTrnsPurchase (supplier invoice 1 → Farm Fresh Milk), selectInvoiceDetails
(invcNo 10), selectTrnsSalesList, selectCustomerList, selectTaxPayerInfo. Raw responses in `api-responses/`.
