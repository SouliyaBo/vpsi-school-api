/**
 * ລະບຽບການຕັດຄະແນນອຸປະນິໄສ — a starting rule sheet.
 *
 * The school's own sheet for 2026–2027 numbers its rules by the column they sit
 * in: `2.1` is the first rule in the ຕັດ 10 ຄະແນນ column. Those numbers are what
 * a teacher reads off the wall and what a letter home cites, so they are the
 * code here rather than anything generated.
 *
 * **This list is deliberately incomplete.** It carries only the items that could
 * be transcribed from the photographed sheet with confidence; the 5-point and
 * 20-point columns, and several items in the 15-point column, are not here. They
 * are added on the ລະບຽບ screen, which is where the sheet is maintained from
 * anyway — this seed exists to give a new database a working sheet to record
 * against on day one, not to be the sheet. It inserts and never overwrites, so
 * anything the office edits or adds stays edited.
 */
export const CONDUCT_RULE_SEEDS: {
  code: string;
  points: number;
  nameLo: string;
  nameEn: string;
  sortOrder: number;
}[] = [
  {
    code: '2.1',
    points: 10,
    nameLo: 'ໃຊ້ເຄື່ອງມືສື່ສານໃນເວລາຮຽນ (ໂທລະສັບ, ໄອແພັດ, ຫູຟັງ, ຄອມພິວເຕີ...)',
    nameEn: 'Using a device during class (phone, tablet, headphones, computer…)',
    sortOrder: 1,
  },
  {
    code: '2.4',
    points: 10,
    nameLo: 'ສ້າງຄວາມວຸ້ນວາຍ ແລະ ຄວາມປັ່ນປ່ວນພາຍໃນຫ້ອງຮຽນ',
    nameEn: 'Causing noise or disruption inside the classroom',
    sortOrder: 4,
  },
  {
    code: '2.5',
    points: 10,
    nameLo: 'ນຳອາຫານ ແລະ ເຄື່ອງດື່ມ (ນ້ຳອັດລົມ, ນ້ຳຫວານ) ເຂົ້າມາກິນໃນຫ້ອງຮຽນ',
    nameEn: 'Bringing food or drink (soft drinks, sweet drinks) into the classroom',
    sortOrder: 5,
  },
  {
    code: '3.4',
    points: 15,
    nameLo: 'ນັກຮຽນຊາຍໃສ່ຕ່າງຫູ',
    nameEn: 'A male student wearing earrings',
    sortOrder: 4,
  },
];
