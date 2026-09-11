/**
 * The rubric printed on ຮ່າງການຕິດຕາມການສອນຂອງຄູສອນ.
 *
 * Held in code rather than in a collection the office edits. The six criteria
 * are printed on the paper form and every sheet is scored against the same six;
 * making them editable data would buy the office a freedom it has not asked for
 * and cost the school the one thing the scores are for — a total from October
 * that means the same as a total from March. When the form itself is reissued,
 * this file changes and the change is visible in the diff, which is the right
 * amount of ceremony for rewriting how staff are judged.
 *
 * Each criterion carries the two indicator lines the form prints beside it. They
 * are guidance for the observer, not sub-scores: the form has one box per row,
 * worth ten, and so does this.
 */

/** What one row of the form is worth. */
export const CRITERION_MAX_SCORE = 10;

export interface ObservationCriterion {
  /** Stable key stored on the sheet — see `ObservationScore.criterion`. */
  key: string;
  /** 1–6, the ordinal printed on the form. */
  order: number;
  /** ດ້ານການຕິດຕາມ — the column-one heading. */
  labelLo: string;
  labelEn: string;
  /** ການປະເມີນ — the two descriptor lines in column two. */
  indicatorsLo: [string, string];
  indicatorsEn: [string, string];
}

export const OBSERVATION_CRITERIA: readonly ObservationCriterion[] = [
  {
    key: 'classroom_control',
    order: 1,
    labelLo: 'ການຄຸມຫ້ອງ ແລະ ເວລາ',
    labelEn: 'Classroom and time management',
    indicatorsLo: [
      'ຄວບຄຸມບັນຍາກາດ ແລະ ລະບຽບໃນຫ້ອງໄດ້ດີ',
      'ດຳເນີນການສອນ ແລະ ກິດຈະກຳຕາມເວລາທີ່ກຳນົດ',
    ],
    indicatorsEn: [
      'Keeps good order and atmosphere in the room',
      'Runs the lesson and its activities to time',
    ],
  },
  {
    key: 'activities',
    order: 2,
    labelLo: 'ການຈັດກິດຈະກຳ',
    labelEn: 'Activities',
    indicatorsLo: [
      'ກິດຈະກຳສົ່ງເສີມໃຫ້ນັກຮຽນໄດ້ຄິດ / ໄດ້ປະຕິບັດຕົວຈິງ',
      'ນັກຮຽນທຸກຄົນມີສ່ວນຮ່ວມໃນກິດຈະກຳຢ່າງທົ່ວເຖິງ',
    ],
    indicatorsEn: [
      'Activities make pupils think, or do the thing themselves',
      'Every pupil takes part, not only the front row',
    ],
  },
  {
    key: 'materials',
    order: 3,
    labelLo: 'ການນຳໃຊ້ສື່',
    labelEn: 'Teaching materials',
    indicatorsLo: [
      'ສື່ມີຄວາມເໝາະສົມກັບເນື້ອໃນ ແລະ ລະດັບນັກຮຽນ',
      'ການນຳໃຊ້ສື່ມີປະສິດທິຜົນ, ກະຕຸ້ນການຮຽນຮູ້',
    ],
    indicatorsEn: [
      'Materials suit the content and the pupils’ level',
      'Materials are used to effect and spark interest',
    ],
  },
  {
    key: 'explanation',
    order: 4,
    labelLo: 'ການອະທິບາຍເນື້ອໃນ',
    labelEn: 'Explaining the content',
    indicatorsLo: [
      'ອະທິບາຍເນື້ອໃນຖືກຕ້ອງ, ກົງປະເດັນ, ຈະແຈ້ງ',
      'ນຳໃຊ້ສຽງ, ພາສາ, ຄວາມຮູ້, ການຖ່າຍທອດເໝາະສົມ',
    ],
    indicatorsEn: [
      'Explains correctly, to the point and clearly',
      'Voice, language and delivery are well judged',
    ],
  },
  {
    key: 'assessment',
    order: 5,
    labelLo: 'ການປະເມີນ ແລະ ສະຫຼຸບ',
    labelEn: 'Checking and summing up',
    indicatorsLo: ['ມີການປະເມີນຄວາມເຂົ້າໃຈນັກຮຽນລະຫວ່າງ', 'ມີການສະຫຼຸບເນື້ອໃນບົດຮຽນຫຍໍ້ຢ່າງຈະແຈ້ງ'],
    indicatorsEn: [
      'Checks the pupils’ understanding as the lesson runs',
      'Closes with a short, clear summary of the lesson',
    ],
  },
  {
    key: 'discipline',
    order: 6,
    labelLo: 'ການຕິດຕາມລະບຽບນັກຮຽນພາຍໃນຫ້ອງ',
    labelEn: 'Following up pupil discipline in the room',
    indicatorsLo: [
      'ກວດສາຍຕາຕິດຕາມຄວາມເປັນລະບຽບ ແລະ ຄວາມຮຽບຮ້ອຍຂອງນັກຮຽນຢ່າງທົ່ວເຖິງ',
      'ຕັກເຕືອນການຜິດລະບຽບຂອງນັກຮຽນຢ່າງໃຫ້ຊິດ ແລະ ທັນທ່ວງທີ',
    ],
    indicatorsEn: [
      'Keeps an eye across the whole room, not one corner of it',
      'Corrects a breach of the rules closely and at the time',
    ],
  },
] as const;

/** The rubric keys, in the order the form prints them. */
export const CRITERION_KEYS: readonly string[] = OBSERVATION_CRITERIA.map((c) => c.key);

/** ຄະແນນເຕັມ — what a completed sheet is out of. 6 × 10. */
export const OBSERVATION_MAX_TOTAL = OBSERVATION_CRITERIA.length * CRITERION_MAX_SCORE;

export function isCriterionKey(value: string): boolean {
  return CRITERION_KEYS.includes(value);
}

/** A mark as it arrives from the client, before it is a stored line. */
export interface ScoreInput {
  criterion: string;
  score?: number | null;
}

export interface ObservationTotals {
  /** ລວມຄະແນນປະເມີນ — the sum of the marks actually given. */
  totalScore: number;
  /** 10 × the number of lines marked, so a half-filled draft reads honestly. */
  maxScore: number;
  /** How many of the six carry a mark. */
  scoredCount: number;
  /** 0–100 against `maxScore`, one decimal; `null` when nothing is marked. */
  percentage: number | null;
}

/**
 * Fills the rubric out from whatever the client sent.
 *
 * Always returns all six lines in rubric order, whether or not the client sent
 * them: a sheet is the form, and a form with rows missing is not a shorter form,
 * it is one with blanks. Unknown keys are dropped rather than rejected here —
 * the DTO rejects them at the edge, and this stays a pure function of the rubric.
 */
export function normalizeScores(
  input: ScoreInput[] = [],
): { criterion: string; score: number | null }[] {
  const sent = new Map(
    input.filter((row) => isCriterionKey(row.criterion)).map((row) => [row.criterion, row.score]),
  );

  return OBSERVATION_CRITERIA.map((criterion) => {
    const value = sent.get(criterion.key);
    return {
      criterion: criterion.key,
      score: value === undefined || value === null ? null : value,
    };
  });
}

/**
 * Merges an update onto the lines already stored.
 *
 * A criterion the client did not mention keeps its mark; one sent as `null` is
 * cleared back to unmarked. Same contract as the monthly mark grid, and for the
 * same reason: a form that quietly blanked the rows you did not touch is a form
 * that loses work.
 */
export function mergeScores(
  stored: ScoreInput[],
  update: ScoreInput[],
): { criterion: string; score: number | null }[] {
  const merged = new Map(normalizeScores(stored).map((row) => [row.criterion, row.score]));

  for (const row of update) {
    if (!isCriterionKey(row.criterion)) continue;
    merged.set(row.criterion, row.score ?? null);
  }

  return OBSERVATION_CRITERIA.map((criterion) => ({
    criterion: criterion.key,
    score: merged.get(criterion.key) ?? null,
  }));
}

export function computeTotals(scores: ScoreInput[]): ObservationTotals {
  const marked = normalizeScores(scores).filter(
    (row): row is { criterion: string; score: number } => row.score !== null,
  );

  const totalScore = marked.reduce((sum, row) => sum + row.score, 0);
  const maxScore = marked.length * CRITERION_MAX_SCORE;

  return {
    totalScore,
    maxScore,
    scoredCount: marked.length,
    percentage: maxScore === 0 ? null : Math.round((totalScore / maxScore) * 1000) / 10,
  };
}

/** The rubric keys still unmarked — what stops a sheet from being submitted. */
export function unscoredCriteria(scores: ScoreInput[]): string[] {
  return normalizeScores(scores)
    .filter((row) => row.score === null)
    .map((row) => row.criterion);
}
