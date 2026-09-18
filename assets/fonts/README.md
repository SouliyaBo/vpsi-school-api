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

### Phetsarath OT — required for official letters

`ໃບຢັ້ງຢືນການສຶກສາ` and anything else the school signs is set in **Phetsarath
OT**, the Lao government's own typeface, because that is what a signed Lao
document looks like. Fetch it alongside Noto:

```bash
curl -Lo assets/fonts/Phetsarath-Regular.ttf \
  https://raw.githubusercontent.com/google/fonts/main/ofl/phetsarath/Phetsarath-Regular.ttf
curl -Lo assets/fonts/Phetsarath-Bold.ttf \
  https://raw.githubusercontent.com/google/fonts/main/ofl/phetsarath/Phetsarath-Bold.ttf
```

Unlike Noto Sans Lao, Phetsarath **contains digits**, so a date and a telephone
number are set in the same face as the words around them. It has **no Latin
alphabet**, so a Latin word still falls back to Helvetica — which is why
`study-certificate.renderer.ts` decides its own script boundary rather than
reusing the report card's.

Without it, letters fall back to whatever `resolveLaoFonts` finds and log a
warning at startup: legible, but the digits change face mid-line.

`font-resolver.ts` looks in this directory automatically. Alternatively point
`PDF_FONT_PATH` / `PDF_FONT_BOLD_PATH` (report cards) or
`PDF_OFFICIAL_FONT_PATH` / `PDF_OFFICIAL_FONT_BOLD_PATH` (official letters) at
any suitable font.

Files in this directory are git-ignored — fonts have their own licences and do
not belong in the repository.

## Fonts that do *not* work

| Font | Problem |
|---|---|
| Helvetica, Times, Courier (PDFKit built-ins) | No Lao glyphs at all — WinAnsi encoding only |
| **Arial Unicode MS** (macOS `/System/Library/Fonts/Supplemental/`) | Has every Lao glyph but **no OpenType tables**, so marks are detached. Excluded from the default search on purpose; usable via `PDF_FONT_PATH` for a rough preview only |

Suitable alternatives for report cards: **Noto Sans Lao** (recommended),
**Phetsarath OT**, **Saysettha OT**. Official letters want Phetsarath OT
specifically.

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

## MathType equations (WMF) — optional fonts

A Word file written with MathType carries each equation as a WMF picture.
LibreOffice (installed in the Docker image; `brew install --cask libreoffice`
on a Mac) draws them into PNG at upload. It substitutes Liberation Serif for
Times and its own Symbol for MathType's; the result reads well. For a closer
match, copy MathType's **Symbol** and **MT Extra** faces from a Windows machine
that has MathType into `/usr/share/fonts/mathtype/` in the image (or
`~/Library/Fonts` on a Mac).
