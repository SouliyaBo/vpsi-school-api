/**
 * Which of the two jobs a subject does, when a caller wants only one of them.
 *
 * The school teaches four ສາຍວິຊາ but, from ມ.4 up, marks eight subjects: see
 * `Subject.parentSubjectId`. Almost every screen wants one list or the other and
 * never the union, so the distinction is named once here rather than re-derived
 * as a filter at each call site.
 */
export const SUBJECT_ROLES = ['taught', 'marked'] as const;
export type SubjectRole = (typeof SUBJECT_ROLES)[number];
