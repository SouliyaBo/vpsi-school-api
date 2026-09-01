import { existsSync } from 'node:fs';
import { isLaoFontAvailable, resetFontCache, resolveOfficialLaoFonts } from './font-resolver';
import { resetLetterheadCache } from './study-certificate-assets';
import { StudyCertificateData, StudyCertificateRenderer } from './study-certificate.renderer';

const laoFontAvailable = (() => {
  resetFontCache();
  return isLaoFontAvailable();
})();

const describeWithFont = laoFontAvailable ? describe : describe.skip;

if (!laoFontAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    '[study-certificate.renderer.spec] No Lao font found — rendering tests skipped. ' +
      'Set PDF_FONT_PATH or run in the Docker image to exercise them.',
  );
}

function sampleData(overrides: Partial<StudyCertificateData> = {}): StudyCertificateData {
  return {
    school: {
      authorityLo: 'ພະແນກສຶກສາທິການ ແລະ ກີລາ',
      nameLo: 'ໂຮງຮຽນ ມ.ສ ນານາຊາດ ວຽງຈັນພັດທະນາ',
      nameFullLo: 'ມັດທະຍົມສົມບູນ ນານາຊາດ ວຽງຈັນພັດທະນາ',
      provinceLo: 'ນະຄອນຫຼວງວຽງຈັນ',
      phone: '020 59163105',
      addressLo: 'ບ້ານ ຂຸນຕາທົ່ງ, ເມືອງ ສີໂຄດຕະບອງ ນະຄອນຫຼວງວຽງຈັນ',
      principalTitleLo: 'ອຳນວຍການໂຮງຮຽນ',
    },
    certificate: { numberLo: '99/ວຈພທນ(ຄນຮ)', issuedDate: new Date('2026-08-31T00:00:00Z') },
    student: {
      titleLo: 'ທ້າວ',
      fullNameLo: 'ສັນຍາຮັກ ວົງສາ',
      dateOfBirth: new Date('2010-04-08T00:00:00Z'),
      birthPlaceLo: 'ບ້ານ ດອນແດງ ເມືອງ ຈັນທະບູລີ ແຂວງ ນະຄອນຫຼວງວຽງຈັນ',
      fatherNameLo: 'ທ້າວ ສະຫງ່ວນ ປອງປັນຍາ',
      motherNameLo: 'ນາງ ສົມໄທຍ ວົງສາ',
      currentAddressLo: 'ບ້ານ ດອນແດງ ເມືອງ ຈັນທະບູລີ ແຂວງ ນະຄອນຫຼວງວຽງຈັນ',
      studentCode: '0707',
      classLabelLo: 'ມ.4',
    },
    study: { fromYearCode: '2022-2023', toYearCode: '2025-2026' },
    ...overrides,
  };
}

describe('the official face', () => {
  beforeEach(() => resetFontCache());
  afterEach(() => resetFontCache());

  // Guarded rather than asserted outright: the font is git-ignored like the
  // others, so a fresh checkout legitimately has only the fallback.
  const phetsarath = existsSync('assets/fonts/Phetsarath-Regular.ttf');
  const itWithPhetsarath = phetsarath ? it : it.skip;

  itWithPhetsarath('prefers Phetsarath and reports that it can set digits', () => {
    const fonts = resolveOfficialLaoFonts();

    expect(fonts.regular).toContain('Phetsarath');
    // What this flag decides: with it false, every date and phone number in the
    // letter is handed to Helvetica mid-line.
    expect(fonts.coversDigits).toBe(true);
  });

  it('refuses a configured path that is not there rather than searching on', () => {
    process.env.PDF_OFFICIAL_FONT_PATH = 'assets/fonts/not-a-font.ttf';
    try {
      expect(() => resolveOfficialLaoFonts()).toThrow(/does not exist/);
    } finally {
      delete process.env.PDF_OFFICIAL_FONT_PATH;
    }
  });
});

describeWithFont('StudyCertificateRenderer', () => {
  let renderer: StudyCertificateRenderer;

  beforeEach(() => {
    renderer = new StudyCertificateRenderer();
    resetLetterheadCache();
  });

  /** A PDF starts with `%PDF-` and ends with `%%EOF`. */
  const looksLikePdf = (buffer: Buffer): boolean =>
    buffer.subarray(0, 5).toString('latin1') === '%PDF-' &&
    buffer.subarray(-1024).toString('latin1').includes('%%EOF');

  it('renders a complete letter', async () => {
    const pdf = await renderer.render(sampleData());

    expect(looksLikePdf(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
  }, 30_000);

  it('renders a letter for a pupil the register knows almost nothing about', async () => {
    // The realistic case rather than an edge one: the school holds a birthplace
    // for one pupil on its whole roll, so every blank field must print as a
    // dotted run instead of failing the render.
    const pdf = await renderer.render(
      sampleData({
        student: {
          ...sampleData().student,
          birthPlaceLo: null,
          fatherNameLo: null,
          motherNameLo: null,
          currentAddressLo: null,
          classLabelLo: null,
        },
        study: { fromYearCode: null, toYearCode: null },
      }),
    );

    expect(looksLikePdf(pdf)).toBe(true);
  }, 30_000);

  it('renders without a date of birth', async () => {
    const pdf = await renderer.render(
      sampleData({ student: { ...sampleData().student, dateOfBirth: null } }),
    );

    expect(looksLikePdf(pdf)).toBe(true);
  }, 30_000);

  it('renders when neither letterhead image is on disk', async () => {
    // A logo that has not been dropped in yet must cost the letter its picture,
    // not the letter itself.
    process.env.PDF_EMBLEM_PATH = 'assets/images/does-not-exist.png';
    process.env.PDF_SCHOOL_LOGO_PATH = 'assets/images/does-not-exist.png';
    resetLetterheadCache();

    try {
      const pdf = await renderer.render(sampleData());
      expect(looksLikePdf(pdf)).toBe(true);
    } finally {
      delete process.env.PDF_EMBLEM_PATH;
      delete process.env.PDF_SCHOOL_LOGO_PATH;
      resetLetterheadCache();
    }
  }, 30_000);

  it('wraps a long unbroken Lao name rather than running it off the page', async () => {
    const pdf = await renderer.render(
      sampleData({
        student: {
          ...sampleData().student,
          // No spaces at all, wider than the measure.
          birthPlaceLo:
            'ບ້ານດອນແດງເມືອງຈັນທະບູລີແຂວງນະຄອນຫຼວງວຽງຈັນປະເທດລາວອາຊີຕະເວັນອອກສ່ຽງໃຕ້ໂລກ',
        },
      }),
    );

    expect(looksLikePdf(pdf)).toBe(true);
  }, 30_000);
});
