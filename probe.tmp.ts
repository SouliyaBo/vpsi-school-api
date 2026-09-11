import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { AttendancesService } from './src/modules/attendances/attendances.service';
import { BehaviorLogsService } from './src/modules/behavior-logs/behavior-logs.service';
import type { RecordTimeliness } from './src/common/record-timeliness/record-timeliness';

const show = (label: string, r: RecordTimeliness) => {
  console.log(`\n══ ${label} ══`);
  console.log(`ช่วง ${r.startDate} – ${r.endDate} · ตัดสินได้ถึง ${r.judgedThrough} · เทอม ${r.semester?.nameLo}`);
  const s = r.summary;
  console.log(`รวม: owed=${s.owed} recorded=${s.recorded} ตรงเวลา=${s.onTime} ช้า=${s.late} ไม่กรอก=${s.missing} ยังไม่ถึงกำหนด=${s.notYetDue}`);
  console.log(`อัตราช้า ${s.lateRate}% · ช้าเฉลี่ย ${s.avgHoursLate} ชม. · ครูที่ช้า ${s.teachersLate} คน · ตัดสินไม่ได้ ${s.unjudged}`);
  console.log('  ครู                             owed  ตรง  ช้า  ไม่กรอก  %ช้า  เฉลี่ย  แย่สุด');
  for (const row of r.rows.slice(0, 8)) {
    console.log(
      `  ${`${row.teacherCode ?? ''} ${row.teacherName}`.padEnd(30)}` +
      `${String(row.owed ?? '—').padStart(5)}${String(row.onTime).padStart(5)}${String(row.late).padStart(5)}` +
      `${String(row.missing ?? '—').padStart(8)}${String(row.lateRate).padStart(7)}${String(row.avgHoursLate).padStart(8)}${String(row.worstHoursLate).padStart(8)}`,
    );
  }
  const worst = r.rows[0];
  if (worst?.lateLessons.length) {
    console.log(`  ตัวอย่างคาบที่ช้าที่สุดของ ${worst.teacherName}:`);
    for (const l of worst.lateLessons.slice(0, 3)) {
      console.log(`    ${l.date}  ${l.gradeLevelCode ?? ''}/${l.classroomName}  ${l.subjectNameLo}  ช้า ${l.hoursLate} ชม.`);
    }
  }
};

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  show('ການເຂົ້າຮຽນ (roll call)', await app.get(AttendancesService).getTimeliness({}));
  show('ພຶດຕິກຳ (behaviour register)', await app.get(BehaviorLogsService).getTimeliness({}));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
