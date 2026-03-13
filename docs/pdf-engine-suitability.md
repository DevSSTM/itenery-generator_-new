# TypeScript PDF Engine Suitability

## Rule baseline (implemented in `src/pdf-engine.ts`)
- Single page: header + footer required.
- Multi page: header on first page, footer on last page.
- Fixed page margins and printable body area.
- No body overflow outside printable area.
- Validation is required before render/download.
- No automatic content splitting by default (readability-safe baseline).

## Candidate engines
1. `html2canvas + jsPDF`
- Best when your template is already DOM/CSS heavy.
- Fastest migration.
- Output is image-based (text is not easily searchable/selectable).

2. `@react-pdf/renderer`
- Best balance for TypeScript + component-driven layout + selectable text.
- Cleaner pagination than DOM screenshot flow.
- Medium migration effort.

3. `pdf-lib`
- Best for maximum control and compact, high-quality output.
- Highest engineering effort (manual drawing/layout).

## Most suitable for this project now
1. `@react-pdf/renderer` for long-term maintainability and true layout control in TypeScript.
2. Keep `html2canvas + jsPDF` only if you want minimum refactor and need exact CSS look immediately.

## How to evaluate quickly
1. Build one identical itinerary in each engine.
2. Compare:
- Rule pass rate (header/footer/margins/overflow)
- File size
- Generation speed
- Text select/search quality
- Effort to maintain template changes
