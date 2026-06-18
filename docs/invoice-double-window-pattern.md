# #10 Double-Window Envelope Invoice Template Pattern

**Purpose:** A reliable, copy-pasteable base that Grok Build, Composer (Fast) 2.5, or other AI coding tools can consume to generate or refine a professional invoice that correctly aligns with a **standard #10 double-window envelope** (4.125" × 9.5", tri-fold letter).

When folded (typical letter fold, top panel ~3.5–4.25" from top of page):
- Upper window shows the **Return Address** (sender).
- Lower window shows the **Recipient / Bill-To / Mail-To address**.
- All other content (logo, Invoice header, line items, totals, terms) stays below the fold area so it is not visible in the windows and prints cleanly on the inside/outside.

## Target Measurements (Unfolded 8.5" × 11" Letter)

| Element                  | From Top | From Left     | Width     | Notes |
|--------------------------|----------|---------------|-----------|-------|
| Return Address           | 0.5–0.75" | 0.75–0.875"  | ~3–3.5"  | 3–4 lines, 9–10pt, bold company name |
| Recipient / Bill To      | 2.25–2.6" | 0.75–0.875"  | ~3.5–4"  | 4–5 lines max, 10–11pt |
| Main content start       | 4.0–4.5" | (full width after margins) | — | "Invoice", line items, totals, etc. |
| Left margin (for windows)| —        | 0.75–0.875"  | —        | Standard for #10 window |
| Fold / top panel         | ~4.0"    | —            | —        | Content below this stays out of windows |

**References:**
- PostalMethods envelope guide (return 0.25–1.5", recipient 2.25–3.25")
- Common manufacturer templates (2 9/16" recipient box, 7/8" left)
- USPS clear zone / 1/8" margin inside windows

---

## 1. Recommended Prompt to Feed Grok Build / Composer 2.5

```
Create a professional one-page invoice template optimized for a standard US #10 double-window envelope (4.125" x 9.5", letter tri-fold).

Strict positioning requirements (critical):
- Return address block (company name + address + phone/email) must be at top-left, starting ~0.5–0.75 inches from the top edge and ~0.75–0.875" from the left edge. This must land in the UPPER window.
- Recipient / "Bill To" / mailing address block must start ~2.5 inches from the top edge, same left margin. This must land cleanly in the LOWER window after a standard tri-fold (fold line ~3.7–4.25" from top).
- All other invoice content (Invoice title, number, dates, line items table, totals, payment terms, footer) must begin no higher than 4.25–4.5 inches from the top so it stays completely below the envelope windows when folded.

Use a clean business style (Arial or similar, 10–11pt body). Support:
- Company logo (optional placeholder)
- Invoice #, service dates, due date
- Line items with description / qty / rate / amount
- Subtotal, tax, total
- Payment instructions (check / email / mail to)
- Small footer

Output formats:
- Self-contained HTML + CSS (print/PDF-ready, @page letter portrait). Use absolute positioning or a reliable table/spacer technique that survives PDF conversion (Prince, WeasyPrint, browser print to PDF).
- A Markdown version.
- Clear instructions or a second file showing how to translate the layout into Microsoft Word styles or the `docx` npm library (tables with exact row heights in twips, left margin 0.875", no top margin, etc.).

Use these sample values for the example:
Company: Capital City Windows, Juneau AK area, phone 907.723.4617
Return address uses a PO Box or street mailing address.
Customer example: "Oak Street LLC", "123 Oak St, Juneau, AK 99801"

Make the template easy to customize (variables or clear [PLACEHOLDERS]).
Emphasize that the addresses must survive folding and show through both windows with ~1/8" clearance even if the insert shifts a little.
```

---

## 2. Refined HTML + CSS Pattern (Improved)

Copy this as your base. It fixes a few issues in looser versions (container positioning, print safety, better spacing, consistent inches).

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice — #10 Double Window</title>
  <style>
    @page {
      size: letter portrait;
      margin: 0;
    }
    html, body {
      margin: 0;
      padding: 0;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10.5pt;
      line-height: 1.35;
      color: #222;
    }
    .page {
      width: 8.5in;
      min-height: 11in;
      position: relative; /* required for absolute children */
      margin: 0 auto;
      background: white;
      box-shadow: 0 0 0 1px #eee; /* visual only for screen */
    }

    /* === ENVELOPE WINDOW ZONES (do not change lightly) === */
    .return-address {
      position: absolute;
      top: 0.6in;
      left: 0.8in;
      width: 3.6in;
      font-size: 9.5pt;
      line-height: 1.3;
    }
    .return-address .company {
      font-weight: bold;
      font-size: 10.5pt;
    }

    .recipient {
      position: absolute;
      top: 2.45in;
      left: 0.8in;
      width: 3.8in;
      font-size: 10.5pt;
      line-height: 1.35;
    }
    .recipient .label {
      font-weight: bold;
      font-size: 9pt;
      margin-bottom: 2px;
    }

    /* === MAIN CONTENT (must start below fold / windows) === */
    .main {
      position: relative;
      margin-top: 4.35in;   /* critical — keeps everything out of the windows */
      padding: 0 0.75in 0.5in 0.75in;  /* left matches envelope left */
    }

    .invoice-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #111;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .invoice-header h1 {
      font-size: 26pt;
      margin: 0;
      letter-spacing: 1px;
    }
    .meta {
      text-align: right;
      font-size: 10pt;
    }
    .meta .invoice-num {
      font-weight: bold;
      font-size: 11pt;
    }

    table.line-items {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0 8px;
    }
    table.line-items th,
    table.line-items td {
      border: 1px solid #ccc;
      padding: 6px 8px;
      text-align: left;
      font-size: 10pt;
    }
    table.line-items th {
      background: #f4f4f4;
      font-weight: 600;
    }
    table.line-items .amount,
    table.line-items .qty,
    table.line-items .rate {
      text-align: right;
    }

    .totals {
      margin-left: auto;
      width: 42%;
      border-collapse: collapse;
    }
    .totals td {
      padding: 4px 8px;
      font-size: 10pt;
    }
    .totals .total-row td {
      font-weight: bold;
      border-top: 1.5px solid #111;
    }

    .payment {
      margin-top: 18px;
      font-size: 9.5pt;
      color: #444;
    }
    .footer {
      margin-top: 36px;
      font-size: 8.5pt;
      color: #555;
      text-align: center;
      border-top: 1px solid #ddd;
      padding-top: 8px;
    }

    /* Print / PDF helpers */
    @media print {
      .page { box-shadow: none; }
      .return-address, .recipient { -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="page">

    <!-- RETURN ADDRESS (upper window) -->
    <div class="return-address">
      <div class="company">Capital City Windows</div>
      PO Box 100<br>
      Juneau, AK 99801<br>
      (907) 723-4617<br>
      billing@capitalcitywindows.com
    </div>

    <!-- RECIPIENT / BILL TO (lower window) -->
    <div class="recipient">
      <div class="label">Bill To / Mail To:</div>
      <strong>[Customer Name]</strong><br>
      [Company or " "]<br>
      [Street or PO Box]<br>
      [City, State ZIP]<br>
      [Phone / Email if desired]
    </div>

    <!-- EVERYTHING BELOW THE FOLD -->
    <div class="main">
      <div class="invoice-header">
        <div>
          <!-- <img src="logo.png" alt="Capital City Windows" style="height:48px"> -->
        </div>
        <div style="text-align:right">
          <h1>INVOICE</h1>
          <div class="meta">
            <div class="invoice-num">INV-2026-0042</div>
            <div>Invoice Date: June 17, 2026</div>
            <div><strong>Due:</strong> July 17, 2026</div>
            <div>Service: June 15, 2026</div>
          </div>
        </div>
      </div>

      <table class="line-items">
        <thead>
          <tr>
            <th style="width:52%">Description</th>
            <th style="width:12%" class="qty">Qty</th>
            <th style="width:16%" class="rate">Rate</th>
            <th style="width:20%" class="amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Full exterior window cleaning</td>
            <td class="qty">1</td>
            <td class="rate">$450.00</td>
            <td class="amount">$450.00</td>
          </tr>
          <tr>
            <td>Screen cleaning &amp; repair (4)</td>
            <td class="qty">4</td>
            <td class="rate">$75.00</td>
            <td class="amount">$300.00</td>
          </tr>
        </tbody>
      </table>

      <table class="totals">
        <tr><td>Subtotal</td><td class="amount">$750.00</td></tr>
        <tr><td>CBJ Sales Tax (5.0%)</td><td class="amount">$37.50</td></tr>
        <tr class="total-row"><td>Total Due</td><td class="amount"><strong>$787.50</strong></td></tr>
      </table>

      <div class="payment">
        <strong>Payment:</strong> Make checks payable to Capital City Windows.<br>
        Mail to: PO Box 100, Juneau, AK 99801.<br>
        Questions: (907) 723-4617 or billing@capitalcitywindows.com
      </div>

      <div class="footer">
        Thank you for your business! Payment is due within 30 days.
      </div>
    </div>

  </div>
</body>
</html>
```

**How to test the HTML version:**
1. Save as `invoice-test.html`.
2. Open in Chrome/Edge → Print → Save as PDF (or use a dedicated HTML-to-PDF tool).
3. Print the PDF on plain letter paper.
4. Fold using a real #10 double-window envelope (bottom third up, then top third down).
5. Verify both addresses are fully visible in their respective windows with clearance.

---

## 3. Word / `docx` Library Translation (for programmatic generation)

The HTML absolute technique does **not** translate 1:1 to Word. Use this structure instead (this is what the project's current generator does):

```ts
// High-level structure used by docx (twips = 1440 per inch)
const TWIP = 1440;

const LEFT_MARGIN = Math.round(0.875 * TWIP);   // 1260
const RETURN_TOP = Math.round(0.5 * TWIP);      // 720
const RECIPIENT_TOP = Math.round(2.5 * TWIP);   // 3600
const CONTENT_START = Math.round(4.25 * TWIP);  // ~6120 (or use panel height)

- Page size 8.5" x 11", top margin = 0, left = LEFT_MARGIN
- Outer 1-column table
  - Row 1: height = CONTENT_START (or 4.0–4.25"), contains a nested 2-column table:
      - Column widths: ~4.5in (address window width) + remaining
      - Row A (height = RECIPIENT_TOP): left cell = Return address (first para has spacingBefore = RETURN_TOP)
      - Row B: left cell = Recipient address block
      - Right column in the same rows holds Invoice title/meta (top) and Service location (aligned with recipient)
  - Row 2 (no fixed height or with top padding): line items table + totals + payment text
```

Key tricks that work reliably:
- Use `TableRow({ height: { value: XXX, rule: 'exact' } })`
- Zero cell margins on address cells.
- Paragraph `spacing: { before, after }` in twips for fine vertical control.
- Addresses live in narrow left column only.
- Everything else flows normally after the tall top row.

---

## 4. Quick Customization Checklist for AI Tools

When asking Grok Build / Composer:
- Paste the prompt from section 1 + this whole file.
- Attach real data (return address from options, sample client bill-to, 2–4 line items).
- Ask for "output a self-contained HTML first, then a section showing the equivalent docx table code".
- "Iterate until a printed + folded test on real #10 stock shows both addresses fully visible with 1/8" clearance."
- For Word users: "Also give me a .docx version or exact instructions for setting paragraph spacing + section margins."

---

**This pattern is intentionally minimal yet precise.** It has been tuned against real #10 double-window requirements and the current project invoice generator.

If you generate a new version from this pattern, test the fold on actual envelopes before mass use.
```

This is a solid, self-contained artifact the user (or other AIs) can feed directly.

Now I need to improve the project's own code to make the generated output better match the "content below ~4.25in" guidance in the pattern.

Let's adjust `layout.ts` and `panels.ts`.