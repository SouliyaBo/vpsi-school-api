/**
 * The register columns of ໝົດປີ ທັງຫ້ອງ — ຄະແນນຖືກຕັດ and ວັນຂາດ beside each month,
 * each term and the year.
 *
 * Kept apart from the service so the one rule that is easy to get wrong is
 * tested on its own: a month nobody recorded anything in is blank, not a clean
 * month. Before the roll is taken there is nothing to say, and a 0 would read as
 * a child who was never absent and never lost a point.
 */

/** One student's figures for one stretch of the year. */
export interface RegisterFigures {
  deducted: number | null;
  absences: number | null;
}

export interface RegisterInputs {
  /** The class roll for the month — `null` when the class has nothing recorded. */
  absences: Map<string, number> | null;
  /** Points taken from each student this month; a student with none is absent. */
  deducted: Map<string, number>;
}

/**
 * The month's figures for one student.
 *
 * The roll decides whether the month has started: a class with no attendance
 * recorded is a month still to come (or one nobody took), so both columns are
 * blank — unless a point was taken anyway, which is a fact whatever the roll says.
 */
export function monthFigures(studentId: string, month: RegisterInputs): RegisterFigures {
  const deducted = month.deducted.get(studentId) ?? null;
  if (month.absences === null) {
    return { absences: null, deducted };
  }
  return { absences: month.absences.get(studentId) ?? 0, deducted: deducted ?? 0 };
}

/**
 * Added over the months that have a figure; blank only when none does, so a
 * term that has not started prints empty rather than as a term of zeros.
 */
export function sumFigures(parts: RegisterFigures[]): RegisterFigures {
  const sum = (values: (number | null)[]) => {
    const written = values.filter((value): value is number => value !== null);
    return written.length > 0 ? written.reduce((total, value) => total + value, 0) : null;
  };
  return {
    deducted: sum(parts.map((part) => part.deducted)),
    absences: sum(parts.map((part) => part.absences)),
  };
}
