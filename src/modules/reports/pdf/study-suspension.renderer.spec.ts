import { isLaoFontAvailable, resetFontCache } from './font-resolver';
import { resetLetterheadCache } from './study-certificate-assets';
import { StudySuspensionData, StudySuspensionRenderer } from './study-suspension.renderer';

const laoFontAvailable = (() => {
  resetFontCache();
  return isLaoFontAvailable();
})();

const describeWithFont = laoFontAvailable ? describe : describe.skip;

if (!laoFontAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    '[study-suspension.renderer.spec] No Lao font found — rendering tests skipped. ' +
      'Set PDF_FONT_PATH or run in the Docker image to exercise them.',
  );
}

function sampleData(overrides: Partial<StudySuspensionData> = {}): StudySuspensionData {
  return {
    school: {
      authorityLo: 'ພະແນກສຶກສາທິການ ແລະ ກີລາ',
      nameLo: 'ໂຮງຮຽນ ມ.ສ ນານາຊາດ ວຽງຈັນພັດທະນາ',
      provinceLo: 'ນະຄອນຫຼວງວຽງຈັນ',
      phone: '020 59163105',
      principalTitleLo: 'ອຳນວຍການໂຮງຮຽນ',
    },
    memo: { numberLo: '100/ວຈພທນ(ຄນຮ)', issuedDate: new Date('2026-09-17T00:00:00Z') },
    guardian: {
      nameLo: 'ທ້າວ ສະຫງ່ວນ ປອງປັນຍາ',
      phone: '020 55512345',
      villageLo: 'ດອນແດງ',
      districtLo: 'ຈັນທະບູລີ',
      provinceLo: 'ນະຄອນຫຼວງວຽງຈັນ',
    },
    student: {
      titleLo: 'ທ້າວ',
      fullNameLo: 'ສັນຍາຮັກ ວົງສາ',
      studentCode: '0707',
      classLabelLo: 'ມ.1/ກ',
    },
    suspension: {
      schoolYearCode: '2026-2027',
      fromDate: new Date('2026-10-01T00:00:00Z'),
      reasonLo: 'ໄປຮຽນຕໍ່ຕ່າງປະເທດ (ໄທ, ຈີນ, ອ໋ອດສະເຕເລຍ, ສິງກະໂປ, ຍີ່ປຸ່ນ)',
      documentsLo: ['ປຶ້ມຕິດຕາມມັດທະຍົມ', 'ໃບປະກາດ ມ.4', 'ໃບຄະແນນ report card ຊັ້ນ ມ.3'],
    },
    ...overrides,
  };
}

describeWithFont('StudySuspensionRenderer', () => {
  let renderer: StudySuspensionRenderer;

  beforeEach(() => {
    renderer = new StudySuspensionRenderer();
    resetLetterheadCache();
  });

  /** A PDF starts with `%PDF-` and ends with `%%EOF`. */
  const looksLikePdf = (buffer: Buffer): boolean =>
    buffer.subarray(0, 5).toString('latin1') === '%PDF-' &&
    buffer.subarray(-1024).toString('latin1').includes('%%EOF');

  it('renders a complete memo', async () => {
    const pdf = await renderer.render(sampleData());

    expect(looksLikePdf(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
  }, 30_000);

  it('renders a memo for a pupil with no guardian, address or placement on file', async () => {
    // Every register-sourced field blank at once: each must print as a dotted
    // run rather than fail the render, and the two hand-written fields must
    // still get their ruled lines.
    const pdf = await renderer.render(
      sampleData({
        guardian: {
          nameLo: null,
          phone: null,
          villageLo: null,
          districtLo: null,
          provinceLo: null,
        },
        student: { ...sampleData().student, classLabelLo: null },
        suspension: { schoolYearCode: null, fromDate: null, reasonLo: null, documentsLo: [] },
      }),
    );

    expect(looksLikePdf(pdf)).toBe(true);
  }, 30_000);

  it('renders when neither letterhead image is on disk', async () => {
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

  it('keeps the memo to one page with the longest document list the form allows', async () => {
    // The form is signed at the foot of a single sheet. A second page would
    // put the signatures on a page with nothing else on it, which is exactly
    // the layout the office cannot use.
    const pdf = await renderer.render(
      sampleData({
        suspension: {
          ...sampleData().suspension,
          reasonLo: 'ຍ້າຍໂຮງຮຽນໃໝ່ (ທີ່ບໍ່ມີພາກພາສາລາວ) ແລະ ຍ້າຍບ້ານໄປຢູ່ຕ່າງແຂວງ ນຳຄອບຄົວ',
          documentsLo: [
            'ປຶ້ມຕິດຕາມປະຖົມ',
            'ປຶ້ມຕິດຕາມມັດທະຍົມ',
            'ໃບປະກາດ ມ.4',
            'ໃບປະກາດ ມ.7',
            'ໃບຄະແນນ report card ຊັ້ນ ມ.7',
            'ໃບຢັ້ງຢືນການສຶກສາ ສະບັບເດີມ',
          ],
        },
      }),
    );

    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages).toHaveLength(1);
  }, 30_000);
});
