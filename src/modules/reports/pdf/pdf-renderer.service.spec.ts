import {
  DEFAULT_CERTIFICATE_LAYOUT,
  DEFAULT_REPORT_CARD_LAYOUT,
  ReportLayout,
} from './layout.types';
import { isLaoFontAvailable, resetFontCache } from './font-resolver';
import {
  markLabel,
  PdfRendererService,
  ReportData,
  segmentByScript,
  toMarkScale,
} from './pdf-renderer.service';

describe('segmentByScript', () => {
  it('returns nothing for an empty string', () => {
    expect(segmentByScript('')).toEqual([]);
  });

  it('keeps pure Lao text as one run', () => {
    expect(segmentByScript('ຄະນິດສາດ')).toEqual([{ text: 'ຄະນິດສາດ', isLao: true }]);
  });

  it('keeps pure Latin text as one run', () => {
    expect(segmentByScript('Mathematics')).toEqual([{ text: 'Mathematics', isLao: false }]);
  });

  it('splits a Lao label from its numeric value', () => {
    // The reason this function exists: the Lao font has no digits at all, so a
    // number left inside a Lao run renders as nothing.
    const runs = segmentByScript('ລະຫັດ: S-2025-0001');
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual({ text: 'ລະຫັດ', isLao: true });
    expect(runs[1].isLao).toBe(false);
    expect(runs[1].text).toBe(': S-2025-0001');
  });

  it('keeps a phone number in parentheses as one Latin run', () => {
    const runs = segmentByScript('ບຸນມີ ສີສຸວັນ (02055500001)');
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual({ text: 'ບຸນມີ ສີສຸວັນ ', isLao: true });
    expect(runs[1]).toEqual({ text: '(02055500001)', isLao: false });
  });

  it('keeps spaces with the Lao run rather than splitting on them', () => {
    // Splitting on every space would produce a run per word and multiply the
    // number of draw calls for no benefit.
    const runs = segmentByScript('ຊື່ ແລະ ນາມສະກຸນ');
    expect(runs).toHaveLength(1);
    expect(runs[0].isLao).toBe(true);
  });

  it('handles text that alternates scripts repeatedly', () => {
    const runs = segmentByScript('ຄະແນນ 85.50 ເກຣດ A');
    expect(runs.map((run) => run.isLao)).toEqual([true, false, true, false]);
  });

  it('reassembles to exactly the input', () => {
    const samples = [
      'ຄະແນນສະເລ່ຍ: 67.90  (C)',
      'GPA: 2.40',
      'ອັນດັບໃນຫ້ອງ: 12 / 42',
      '    · ສອບເສັງກາງພາກ: 34.00 / 40  (40%)',
      'ວັນທີ: 06/08/2026',
    ];

    for (const sample of samples) {
      expect(
        segmentByScript(sample)
          .map((run) => run.text)
          .join(''),
      ).toBe(sample);
    }
  });
});

/**
 * The school marks out of 10, and its report card has to read that way — while
 * the stored figure stays a percentage, because that is what ranks a class and
 * averages across subjects marked either way.
 */
describe('toMarkScale', () => {
  it('leaves a percentage alone when nothing says otherwise', () => {
    expect(toMarkScale(83.1, {})).toBe(83.1);
    expect(markLabel({}, 'lo')).toBe('ຄະແນນ (%)');
  });

  it('reads a stored percentage back as the 10-point mark it came from', () => {
    // ເກວະລິນ's ພາກຮຽນ: entered as 8.31, stored as 83.1, printed as 8.31.
    expect(toMarkScale(83.1, { markScale: 10 })).toBe(8.31);
    expect(markLabel({ markScale: 10 }, 'lo')).toBe('ຄະແນນ (10)');
    expect(markLabel({ markScale: 10 }, 'en')).toBe('Score (10)');
  });

  it('rounds to two decimals rather than trailing a float', () => {
    expect(toMarkScale(48.9, { markScale: 10 })).toBe(4.89);
    expect(toMarkScale(66.67, { markScale: 10 })).toBe(6.67);
  });
});

const sampleData = (overrides: Partial<ReportData> = {}): ReportData => ({
  schoolNameLo: 'ໂຮງຮຽນມັດທະຍົມສົມບູນ ວຽງຈັນ',
  student: {
    studentCode: 'S-2025-0001',
    fullNameLo: 'ນາງ ວົງສະຫວັນ',
    genderLo: 'ຍິງ',
    dateOfBirth: new Date('2010-05-14'),
    villageLo: 'ບ້ານໂພນສະຫວັນ',
    guardianLo: 'ບຸນມີ ສີສຸວັນ (02055500001)',
  },
  academic: {
    classroomName: 'ກ',
    gradeLevelLo: 'ມັດທະຍົມສຶກສາປີທີ 4',
    schoolYearCode: '2025-2026',
    semesterLo: 'ພາກຮຽນທີ 1',
  },
  subjects: [
    {
      nameLo: 'ຄະນິດສາດ',
      credits: 4,
      percentage: 85.5,
      grade: 'A',
      gradePoint: 4,
      isPassed: true,
      components: [
        { nameLo: 'ສອບເສັງກາງພາກ', score: 34, maxScore: 40, weight: 40 },
        { nameLo: 'ສອບເສັງທ້າຍພາກ', score: 52, maxScore: 60, weight: 60 },
      ],
    },
    {
      nameLo: 'ພາສາລາວ',
      credits: 4,
      percentage: 45,
      grade: 'F',
      gradePoint: 0,
      isPassed: false,
      components: [{ nameLo: 'ສອບເສັງ', score: 45, maxScore: 100, weight: 100 }],
    },
  ],
  summary: {
    average: 65.25,
    gpa: 2,
    // 65.25 is 6.53 out of 10 — a C on the school's scale.
    grade: 'C',
    rank: 12,
    totalStudents: 42,
    subjectsPassed: 1,
    subjectsFailed: 1,
    isProvisional: false,
  },
  attendance: { present: 80, absent: 3, late: 2, excused: 1 },
  conductGradeLo: 'ດີຫຼາຍ',
  ...overrides,
});

/**
 * These tests need a Lao-capable font, which is an environment dependency rather
 * than something the repo can carry. They are skipped when none is installed —
 * CI runs in the Docker image, which does install one — but the skip is loud so
 * a missing font never looks like a pass.
 */
const laoFontAvailable = (() => {
  resetFontCache();
  return isLaoFontAvailable();
})();

const describeWithFont = laoFontAvailable ? describe : describe.skip;

if (!laoFontAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    '[pdf-renderer.spec] No Lao font found — PDF rendering tests skipped. ' +
      'Set PDF_FONT_PATH or run in the Docker image to exercise them.',
  );
}

describeWithFont('PdfRendererService', () => {
  let renderer: PdfRendererService;

  beforeEach(() => {
    renderer = new PdfRendererService();
  });

  /** A PDF starts with `%PDF-` and ends with `%%EOF`. */
  const looksLikePdf = (buffer: Buffer): boolean =>
    buffer.subarray(0, 5).toString('latin1') === '%PDF-' &&
    buffer.subarray(-1024).toString('latin1').includes('%%EOF');

  it('renders a report card to a complete PDF', async () => {
    const pdf = await renderer.render(DEFAULT_REPORT_CARD_LAYOUT, sampleData());

    expect(looksLikePdf(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
  }, 30_000);

  it('renders a certificate in landscape', async () => {
    const data = sampleData({
      certificate: {
        number: '2025-2026/GRAD/0001',
        issuedDate: new Date('2026-06-30'),
        titleLo: 'ໃບຢັ້ງຢືນຈົບຊັ້ນ',
      },
    });

    const pdf = await renderer.render(DEFAULT_CERTIFICATE_LAYOUT, data);
    expect(looksLikePdf(pdf)).toBe(true);
  }, 30_000);

  it('renders the component breakdown when the layout asks for it', async () => {
    const withComponents: ReportLayout = {
      ...DEFAULT_REPORT_CARD_LAYOUT,
      sections: [{ type: 'subjectsTable', showComponents: true }],
    };

    const withoutComponents: ReportLayout = {
      ...DEFAULT_REPORT_CARD_LAYOUT,
      sections: [{ type: 'subjectsTable', showComponents: false }],
    };

    const [detailed, plain] = await Promise.all([
      renderer.render(withComponents, sampleData()),
      renderer.render(withoutComponents, sampleData()),
    ]);

    // The detailed version has three extra rows of text, so it is larger.
    expect(detailed.length).toBeGreaterThan(plain.length);
  }, 30_000);

  it('renders a provisional result without failing', async () => {
    const data = sampleData({
      summary: { ...sampleData().summary, isProvisional: true },
    });

    const pdf = await renderer.render(DEFAULT_REPORT_CARD_LAYOUT, data);
    expect(looksLikePdf(pdf)).toBe(true);
  }, 30_000);

  it('skips an unknown section rather than throwing', async () => {
    // Forward compatibility: a template authored for a newer build must still
    // produce a usable document.
    const layout = {
      ...DEFAULT_REPORT_CARD_LAYOUT,
      sections: [
        { type: 'text', contentLo: 'ຂໍ້ຄວາມ' },
        { type: 'somethingFromTheFuture' },
        { type: 'summary', showAverage: true },
      ],
    } as unknown as ReportLayout;

    const pdf = await renderer.render(layout, sampleData());
    expect(looksLikePdf(pdf)).toBe(true);
  }, 30_000);

  it('renders with no subjects at all', async () => {
    // A participation certificate has no marks behind it.
    const pdf = await renderer.render(DEFAULT_REPORT_CARD_LAYOUT, sampleData({ subjects: [] }));
    expect(looksLikePdf(pdf)).toBe(true);
  }, 30_000);

  it('omits the attendance section when nothing was recorded', async () => {
    const withAttendance = await renderer.render(
      { ...DEFAULT_REPORT_CARD_LAYOUT, sections: [{ type: 'attendance' }] },
      sampleData(),
    );
    const withoutAttendance = await renderer.render(
      { ...DEFAULT_REPORT_CARD_LAYOUT, sections: [{ type: 'attendance' }] },
      sampleData({ attendance: { present: 0, absent: 0, late: 0, excused: 0 } }),
    );

    expect(withoutAttendance.length).toBeLessThan(withAttendance.length);
  }, 30_000);

  it('omits the conduct line when there is no conduct grade', async () => {
    const withConduct = await renderer.render(
      { ...DEFAULT_REPORT_CARD_LAYOUT, sections: [{ type: 'conduct' }] },
      sampleData(),
    );
    const withoutConduct = await renderer.render(
      { ...DEFAULT_REPORT_CARD_LAYOUT, sections: [{ type: 'conduct' }] },
      sampleData({ conductGradeLo: null }),
    );

    expect(withoutConduct.length).toBeLessThan(withConduct.length);
  }, 30_000);

  it('handles a subject list long enough to need a second page', async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      nameLo: `ວິຊາທີ ${index + 1}`,
      credits: 2,
      percentage: 70 + (index % 20),
      grade: 'B',
      gradePoint: 3,
      isPassed: true,
      components: [],
    }));

    const pdf = await renderer.render(DEFAULT_REPORT_CARD_LAYOUT, sampleData({ subjects: many }));

    expect(looksLikePdf(pdf)).toBe(true);
    // Page numbering in the footer requires the page range to be walked, which
    // is where a multi-page render tends to break.
    expect(pdf.length).toBeGreaterThan(3000);
  }, 30_000);
});

describe('font resolver', () => {
  afterEach(() => {
    delete process.env.PDF_FONT_PATH;
    resetFontCache();
  });

  it('rejects an explicitly configured path that does not exist', () => {
    // Silently searching elsewhere would hide an operator's typo.
    process.env.PDF_FONT_PATH = '/definitely/not/a/font.ttf';
    resetFontCache();

    expect(() => {
      // Imported lazily so the env var is in place first.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      (require('./font-resolver') as typeof import('./font-resolver')).resolveLaoFonts();
    }).toThrow(/does not exist/);
  });
});
