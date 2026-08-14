# Fonts for PDF generation

PDF generation **requires a font that both contains Lao glyphs and carries
OpenType layout tables.** Both halves matter:

- Without Lao glyphs, text renders as blank boxes.
- Without OpenType `GPOS` mark positioning, Lao combining vowels and tone marks
  get a full advance width instead of sitting above their base consonant, so
  `ຜົນ` renders as `ຜ ົ ນ`. The document looks plausible and is wrong.

The second failure is the dangerous one, which is why
`src/modules/reports/pdf/font-resolver.ts` actively checks for it and logs a
warning at startup.

## Docker (nothing to do)

The image runs `apk add --no-cache font-noto-lao`. Reports work out of the box.

## Local development

Alpine's package is not available on macOS or Windows, so fetch the font once:

```bash
mkdir -p assets/fonts
curl -Lo assets/fonts/NotoSansLao-Regular.ttf \
  https://github.com/notofonts/lao/raw/main/fonts/NotoSansLao/hinted/ttf/NotoSansLao-Regular.ttf
curl -Lo assets/fonts/NotoSansLao-Bold.ttf \
  https://github.com/notofonts/lao/raw/main/fonts/NotoSansLao/hinted/ttf/NotoSansLao-Bold.ttf
```

`font-resolver.ts` looks in this directory automatically. Alternatively point
`PDF_FONT_PATH` (and optionally `PDF_FONT_BOLD_PATH`) at any suitable font.

Files in this directory are git-ignored — fonts have their own licences and do
not belong in the repository.

## Fonts that do *not* work

| Font | Problem |
|---|---|
| Helvetica, Times, Courier (PDFKit built-ins) | No Lao glyphs at all — WinAnsi encoding only |
| **Arial Unicode MS** (macOS `/System/Library/Fonts/Supplemental/`) | Has every Lao glyph but **no OpenType tables**, so marks are detached. Excluded from the default search on purpose; usable via `PDF_FONT_PATH` for a rough preview only |

Suitable alternatives: **Noto Sans Lao** (recommended), **Phetsarath OT**,
**Saysettha OT**.

## Verifying a font

```bash
node -e "
const f = require('fontkit').openSync(process.argv[1]);
const run = f.layout('ຜົ');
console.log('family:', f.familyName);
console.log('mark advance (must be 0):', run.positions[1].xAdvance);
" /path/to/font.ttf
```

A non-zero mark advance means the font will produce malformed Lao.
