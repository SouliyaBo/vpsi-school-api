/**
 * The office's book lists, transcribed from the photos and tables the user sent
 * on 12 Oct 2026 — everything except the workbook sales sheet, which they asked
 * to leave out.
 *
 * Counts are by grade code (`m1` … `m7`); a grade a book is not held at is
 * simply absent, as the sheets print "-".
 *
 * Transcription notes (handwritten or blurred on the photo — check against the
 * paper): reference #10, #15, #16, #22 and Book Festival 2025 #8, #15. The
 * reference list has no item 8 and no purchase dates; the red ticks and margin
 * marks on the sheets were not carried over, their meaning being unknown.
 */

export interface CountRowSeed {
  name: string;
  counts: Partial<Record<'m1' | 'm2' | 'm3' | 'm4' | 'm5' | 'm6' | 'm7', number>>;
}

export interface TitleSeed {
  title: string;
  quantity: number;
  unitPrice?: number;
  /** The paper's own row number, kept in the note so the two can be compared. */
  sheetNo: number;
  /** "ຄູຢືມ" on the reference list. */
  borrower?: { name: string; quantity: number };
}

const all = (n: number) => ({ m1: n, m2: n, m3: n, m4: n, m5: n, m6: n, m7: n });

/** ລາຍວິຊາຄູ່ມືຄູ — 141 ຫົວ. */
export const TEACHER_GUIDES: CountRowSeed[] = [
  { name: 'ວິຊາ ພາສາລາວ', counts: all(4) },
  { name: 'ວິຊາ ຄະນິດສາດ', counts: all(4) },
  { name: 'ວິຊາ ຟີຊິກສາດ', counts: { m5: 4, m6: 4, m7: 4 } },
  { name: 'ວິຊາ ເຄມີສາດ', counts: { m5: 4, m6: 4, m7: 4 } },
  { name: 'ວິຊາ ຊີວະສາດ', counts: { m5: 4, m6: 4, m7: 3 } },
  { name: 'ວິຊາ ວິທະຍາສາດທຳມະຊາດ', counts: { m1: 4, m2: 4, m3: 4, m4: 4 } },
  { name: 'ວິຊາ ພາສາອັງກິດ', counts: all(4) },
  { name: 'ວິຊາ ພື້ນຖານປ້ອງກັນຕົວ', counts: { m5: 2, m6: 2, m7: 2 } },
];

/** ແບບຮຽນລາຍວິຊາ — 345 ຫົວ. */
export const TEXTBOOKS: CountRowSeed[] = [
  { name: 'ວິຊາ ພາສາລາວ', counts: { m1: 5, m2: 8, m3: 8, m4: 9, m5: 6, m6: 7, m7: 1 } },
  { name: 'ວິຊາ ວັນນະຄະດີ', counts: { m1: 5, m2: 9, m3: 2, m4: 8, m5: 4, m6: 7, m7: 2 } },
  { name: 'ວິຊາ ຄະນິດສາດ', counts: { m1: 4, m2: 6, m3: 3, m4: 3, m5: 11, m6: 7, m7: 3 } },
  { name: 'ວິຊາ ຟີຊິກສາດ', counts: { m5: 6, m6: 9, m7: 1 } },
  { name: 'ວິຊາ ເຄມີສາດ', counts: { m5: 11, m6: 9, m7: 4 } },
  { name: 'ວິຊາ ຊີວະສາດ', counts: { m5: 6, m6: 5, m7: 1 } },
  { name: 'ວິຊາ ວິທະຍາສາດທຳມະຊາດ', counts: { m1: 4, m2: 3, m4: 2 } },
  { name: 'ວິຊາ ພາສາອັງກິດ', counts: { m3: 4, m4: 2, m5: 1, m7: 2 } },
  { name: 'ວິຊາ ພື້ນຖານວິຊາຊີບ', counts: { m2: 8, m3: 9, m4: 14 } },
  {
    name: 'ວິຊາ ເຕັກໂນໂລຊີຂໍ້ມູນຂ່າວສານ ແລະ ການສື່ສານ',
    counts: { m1: 1, m2: 1, m3: 4, m4: 1, m5: 3, m6: 7, m7: 6 },
  },
  { name: 'ວິຊາ ພູມສາດ', counts: { m1: 4, m2: 6, m3: 5, m4: 3, m5: 5, m6: 13, m7: 3 } },
  { name: 'ວິຊາ ປະຫວັດສາດ', counts: { m1: 5, m2: 5, m3: 5, m4: 5, m5: 6, m6: 10, m7: 1 } },
  { name: 'ວິຊາ ສຶກສາພົນລະເມືອງ', counts: { m1: 4, m2: 2, m3: 2, m4: 4, m5: 4, m6: 10, m7: 1 } },
];

/** ລາຍການປື້ມບໍລິຈາກ ຈາກ Book Festival 2025 (12–16/3/2025) — 29 ຫົວ, 2,572,000 ກີບ. */
export const BOOK_FESTIVAL_2025: TitleSeed[] = [
  { sheetNo: 1, title: 'ຈົນກວ່າຟ້າຈະສົດໃສ ສະບັບປັບປຸງໃໝ່', quantity: 1, unitPrice: 150000 },
  { sheetNo: 2, title: 'ຄົນ 8 ປະເພດທີ່ບໍ່ຄວນຊ່ວຍເຫຼືອ', quantity: 1, unitPrice: 100000 },
  {
    sheetNo: 3,
    title: 'ຄຸນສົມບັດສຳຄັນຂອງຫົວໜ້າທີ່ລູກນ້ອງຢາກເຮັດວຽກນຳ',
    quantity: 1,
    unitPrice: 100000,
  },
  { sheetNo: 4, title: 'ຄິດແບບຄົນສຳເລັດ', quantity: 1, unitPrice: 99000 },
  { sheetNo: 5, title: 'ສຸດຍອດແຮງບັນດານໃຈສ້າງໄດ້ດ້ວຍຕົນເອງ', quantity: 1, unitPrice: 85000 },
  { sheetNo: 6, title: 'ຊີວິດທີ່ມີຄວາມໝາຍ A meaningful life', quantity: 1, unitPrice: 99000 },
  { sheetNo: 7, title: 'ຄຳຄົມຄົນສຳເລັດແລະບຸກຄົນສຳຄັນຂອງໂລກ', quantity: 1, unitPrice: 85000 },
  { sheetNo: 8, title: 'ຄູ່ມືຄອງຄະລິທັດ', quantity: 1, unitPrice: 85000 },
  { sheetNo: 9, title: 'ຄ່ານ້ຳນົມ', quantity: 1, unitPrice: 35000 },
  { sheetNo: 10, title: 'ຄວາມລັບຂອງເງິນ', quantity: 1, unitPrice: 75000 },
  { sheetNo: 11, title: 'ເຄັດລັບຂອງຄົນລວຍ', quantity: 1, unitPrice: 75000 },
  { sheetNo: 12, title: 'ຄຳສູ່ຂວັນ', quantity: 1, unitPrice: 85000 },
  { sheetNo: 13, title: 'ເຄັດລັບສູ່ຄວາມສຳເລັດ (ສຳນັກພິມດີບຸກ)', quantity: 1, unitPrice: 95000 },
  { sheetNo: 14, title: 'ເຈົ້າແມ່ສີເມືອງ (ປົກແຂງ)', quantity: 1, unitPrice: 650000 },
  { sheetNo: 15, title: 'ວົງເພັດ ໄຊເກີຢາຈົງຕົວ ນັກປະຕິວັດ 5 ຍາ', quantity: 1, unitPrice: 150000 },
  { sheetNo: 16, title: 'ຂ້ອຍຈະໄປໃສໜໍ', quantity: 2, unitPrice: 42000 },
  { sheetNo: 17, title: 'ກາບກອນຈາກອັດຕະປື', quantity: 2, unitPrice: 55000 },
  { sheetNo: 18, title: 'ລະຄອນເຈ້ຍ ດວງຕາເວັນ', quantity: 1, unitPrice: 90000 },
  { sheetNo: 19, title: 'ຄູ່ມືສອນພາສາລາວແບບມ່ວນໆ', quantity: 1, unitPrice: 30000 },
  { sheetNo: 20, title: 'ລານຄຳ', quantity: 2, unitPrice: 20000 },
  { sheetNo: 21, title: 'ຍັກຫົວປຸ້ງ', quantity: 2, unitPrice: 35000 },
  { sheetNo: 22, title: 'ສິນໄຊ', quantity: 4, unitPrice: 45000 },
];

/** ລາຍການປື້ມບໍລິຈາກ ຈາກ Book Festival 2026 (10–15/3/2026) — 53 ຫົວ, 3,504,000 ກີບ. */
export const BOOK_FESTIVAL_2026: TitleSeed[] = [
  { sheetNo: 1, title: 'ຫວນຄືນອະດີດເມືອງວຽງໄຊ', quantity: 1, unitPrice: 75000 },
  { sheetNo: 2, title: 'ຄ່ານ້ຳນົມແມ່', quantity: 1, unitPrice: 35000 },
  { sheetNo: 3, title: 'ຈາລຶກໄວ້ໃນແຜ່ນດິນເກີດ', quantity: 1, unitPrice: 85000 },
  { sheetNo: 4, title: 'ແສງທອງສ່ອງທາງ', quantity: 1, unitPrice: 85000 },
  { sheetNo: 5, title: 'ມ່ວນຊື່ນສະຫຼອງໄຊ', quantity: 1, unitPrice: 65000 },
  { sheetNo: 6, title: 'ໃຕ້ຟ້າວັນໃໝ່', quantity: 1, unitPrice: 65000 },
  { sheetNo: 7, title: 'ຕາມຮອຍເຈົ້າອານຸວົງ', quantity: 1, unitPrice: 89000 },
  { sheetNo: 8, title: 'ສິນໄຊ ເຫຼັ້ມດຽວຈົບ', quantity: 2, unitPrice: 38000 },
  { sheetNo: 9, title: 'ສັງສິນໄຊ ເຫຼັ້ມ 2', quantity: 1, unitPrice: 100000 },
  { sheetNo: 10, title: 'ຊີວິດຜູ້ຂ້າ', quantity: 1, unitPrice: 139000 },
  { sheetNo: 11, title: 'ENGLISH DNA', quantity: 1, unitPrice: 150000 },
  { sheetNo: 12, title: 'ເໜືອກວ່າການເປັນນັກຮຽນເກັ່ງ', quantity: 26, unitPrice: 50000 },
  { sheetNo: 13, title: 'ຈຸດຈົບຢູ່ຜາຖີ່', quantity: 4, unitPrice: 85000 },
  { sheetNo: 14, title: 'ສິ່ງທີ່ເຫັນ ສິ່ງທີ່ຄິດ ສິ່ງທີ່ຝັນ', quantity: 4, unitPrice: 85000 },
  { sheetNo: 15, title: 'ທຳນອງຊີວິດ', quantity: 5, unitPrice: 65000 },
  { sheetNo: 16, title: 'ຈົນກວ່າຟ້າຈະສົດໃສ', quantity: 1, unitPrice: 150000 },
  { sheetNo: 17, title: 'ຄຳຄົມແຮງບັນດານໃຈ', quantity: 1, unitPrice: 85000 },
];

/** ລາຍການປື້ມເອກະສານອ້າງອີງ, by ສົກຮຽນ. */
export const REFERENCE_BOOKS: Record<string, TitleSeed[]> = {
  '2019-2020': [
    {
      sheetNo: 1,
      title: 'ກຳມະບານລາວຄົບຮອບ 60 ປີ',
      quantity: 3,
      borrower: { name: 'ສົມເພັດ', quantity: 1 },
    },
    { sheetNo: 2, title: 'ອາຊຽນ', quantity: 3 },
    { sheetNo: 3, title: 'ບຳລຸງຊີວະ', quantity: 3 },
    { sheetNo: 4, title: 'ປື້ມນິພົນເລືອກເຟັ້ນເຫຼັ້ມ IV', quantity: 1 },
    { sheetNo: 5, title: 'ປະຫວັດສາດລາວໂດຍຫຍໍ້', quantity: 1 },
    { sheetNo: 6, title: 'ເສັ້ນທາງກ້າວຂຶ້ນສູ່ສັງຄົມນິຍົມ', quantity: 1 },
    { sheetNo: 7, title: 'ການເຊື່ອມໂຍງສາກົນ', quantity: 1 },
    {
      sheetNo: 9,
      title: 'ລາວ-ດິນແດນແຫ່ງວັດທະນະທຳ',
      quantity: 3,
      borrower: { name: 'ສົມເພັດ', quantity: 1 },
    },
  ],
  '2020-2021': [
    { sheetNo: 10, title: 'ຕົງປາວທີ່ໃຈກ້າ', quantity: 1 },
    { sheetNo: 11, title: 'ປະທານໂຮ່ຈີມິນ', quantity: 1 },
    { sheetNo: 12, title: 'ພົງສາວະດານລາວ', quantity: 1 },
    { sheetNo: 13, title: 'ທ່ານໄກສອນພົມວິຫານ ເຫຼັ້ມ 4', quantity: 1 },
    { sheetNo: 14, title: 'ຮັກສາເອກະລາດໃຫ້ໝັ້ນຄົງ', quantity: 1 },
    { sheetNo: 15, title: 'ທ່ານໝໍ່ດູລິດໂທ', quantity: 1 },
    { sheetNo: 16, title: 'ທ່ຽວທົ່ວລາວ', quantity: 1 },
    { sheetNo: 17, title: 'ຈຸດຈົບຢູ່ຜາຖີ່', quantity: 1 },
    { sheetNo: 18, title: 'ນັກສູ້ແຫ່ງລຸ່ມແມ່ນ້ຳຂອງ', quantity: 1 },
    { sheetNo: 19, title: 'ວັດທະນະທຳ ແລະ ປະເພນີບູຮານລາວ', quantity: 1 },
    { sheetNo: 20, title: 'ລະບອບປະຊາທິປະໄຕ 2012', quantity: 1 },
    { sheetNo: 21, title: 'ປະເພນີລາວ', quantity: 1 },
    { sheetNo: 22, title: 'ບັນດາສາສະໜາທີ່ຄົງຕົວຢູ່ ສປປ ລາວ 2012', quantity: 1 },
    { sheetNo: 23, title: 'ລາວລ້ານຊ້າງສະໄໝກ່ອນຝຣັ່ງປົກຄອງ', quantity: 1 },
    { sheetNo: 24, title: 'ລາວລ້ານຊ້າງສະໄໝຝຣັ່ງປົກຄອງ', quantity: 2 },
    { sheetNo: 25, title: 'ເສດຖະກິດການເມືອງມາກ-ເລນິນ', quantity: 1 },
    { sheetNo: 26, title: 'ເສັ້ນທາງສູ່ສັນຕິພາບ', quantity: 1 },
    { sheetNo: 27, title: 'ຊີວິດ ແລະ ພາລະກິດຂອງສະຫາຍໄກສອນ', quantity: 1 },
    { sheetNo: 28, title: 'Southern Laos', quantity: 2 },
    { sheetNo: 29, title: 'Northern Provinces', quantity: 1 },
  ],
};

export interface WorkbookLineSeed {
  grade: 'm1' | 'm2' | 'm3' | 'm4' | 'm5' | 'm6' | 'm7';
  setsProduced: number;
  /** One per book in the set, with what it sells for. */
  books: { name: string; price: number }[];
}

/**
 * ລາຍລະອຽດຈຳນວນປື້ມແບບບົດເຝິກຫັດ ນຳໃຊ້ສົກຮຽນ 2026–2027 (sent 12 Oct 2026):
 * 102 ຊຸດ, 560 ຫົວ. The per-book prices come from the second sheet and add up
 * to its ລາຄາ/ຊຸດ — 185,000 / 190,000 / 200,000 / 265,000.
 */
export const WORKBOOKS_2026_2027: WorkbookLineSeed[] = [
  {
    grade: 'm4',
    setsProduced: 36,
    books: [
      { name: 'ພາສາລາວ', price: 20000 },
      { name: 'ວັນນະຄະດີ', price: 20000 },
      { name: 'ຄະນິດສາດ', price: 45000 },
      { name: 'ວິທະຍາສາດທຳມະຊາດ', price: 60000 },
      { name: 'ວິທະຍາສາດສັງຄົມ', price: 40000 },
    ],
  },
  {
    grade: 'm5',
    setsProduced: 19,
    books: [
      { name: 'ພາສາລາວ', price: 35000 },
      { name: 'ວັນນະຄະດີ', price: 35000 },
      { name: 'ເຄມີສາດ', price: 40000 },
      { name: 'ຄະນິດສາດ', price: 40000 },
      { name: 'ຟີຊິກສາດ', price: 40000 },
    ],
  },
  {
    grade: 'm6',
    setsProduced: 22,
    books: [
      { name: 'ພາສາລາວ', price: 40000 },
      { name: 'ວັນນະຄະດີ', price: 35000 },
      { name: 'ເຄມີສາດ', price: 45000 },
      { name: 'ຄະນິດສາດ', price: 40000 },
      { name: 'ຟີຊິກສາດ', price: 40000 },
    ],
  },
  {
    grade: 'm7',
    setsProduced: 25,
    books: [
      { name: 'ພາສາລາວ', price: 35000 },
      { name: 'ວັນນະຄະດີ', price: 35000 },
      { name: 'ເຄມີສາດ', price: 40000 },
      { name: 'ຄະນິດສາດ', price: 40000 },
      { name: 'ຊີວະສາດ', price: 30000 },
      { name: 'ຟີຊິກສາດ', price: 40000 },
      { name: 'ວິທະຍາສາດສັງຄົມ', price: 45000 },
    ],
  },
];

/** "ພາສາລາວ 20,000, ວັນນະຄະດີ 20,000, …" — the set's contents with each book's price. */
export function workbookSubjects(line: WorkbookLineSeed): string {
  return line.books.map((book) => `${book.name} ${book.price.toLocaleString('en-US')}`).join(', ');
}

export function workbookPricePerSet(line: WorkbookLineSeed): number {
  return line.books.reduce((sum, book) => sum + book.price, 0);
}
