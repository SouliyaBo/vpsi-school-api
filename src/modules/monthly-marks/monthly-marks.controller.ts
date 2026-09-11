import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  AnnualSheetQueryDto,
  ClassMonthQueryDto,
  LockMonthDto,
  MonthGridQueryDto,
  SaveMonthGridDto,
  SaveTermMarksDto,
  SheetQueryDto,
  StudentMonthsQueryDto,
} from './dto/monthly-mark.dto';
import { MonthlyMarksService } from './monthly-marks.service';

/**
 * ຄະແນນປະຈຳເດືອນ — the school's own mark sheet.
 *
 * One sheet is one subject in one class for one term: four columns a month
 * (ຂື້ນຫ້ອງ 1, ປື້ມ 1, ກິດຈະກຳ 2, ກວດກາ 6), three months, a semester exam, and a
 * bonus. Everything above that — ສະເລ່ຍ, 3 ເດືອນ, ພາກຮຽນ, ໝົດປີ — is derived on
 * read, so a corrected cell moves every figure that depends on it at once.
 *
 * Filed under the `scores` permission rather than a resource of its own: it is
 * how this school records marks, so a teacher who may grade may fill it in, and
 * the office's `scores:manage` is what corrects a class whose teacher has left.
 */
@ApiTags('monthly-marks')
@ApiBearerAuth()
@Controller('monthly-marks')
export class MonthlyMarksController {
  constructor(private readonly service: MonthlyMarksService) {}

  @Get('month')
  @RequirePermissions({ resource: 'scores', action: 'read' })
  @ApiOperation({
    summary: 'The entry grid: one month of one subject for one class',
    description:
      'Every student on the class list comes back, marked or not — the form is filled in ' +
      'against the roll. A subject that declares strands returns one row per strand.',
  })
  monthGrid(@Query() query: MonthGridQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.getMonthGrid(query, actor);
  }

  @Get('semester')
  @RequirePermissions({ resource: 'scores', action: 'read' })
  @ApiOperation({
    summary: 'The term sheet — three months, the exam, and ພາກຮຽນ',
    description:
      'Laid out as the paper form. Nothing is rounded on the way in: a month worth 8.45 ' +
      'carries 8.45 into the three-month average, and rounding is left to the display.',
  })
  semesterSheet(@Query() query: SheetQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.getSemesterSheet(query, actor);
  }

  @Get('annual')
  @RequirePermissions({ resource: 'scores', action: 'read' })
  @ApiOperation({
    summary: 'ໝົດປີ — both terms and their mean',
    description:
      'Derived from the two term sheets rather than stored, so a corrected mark cannot leave ' +
      'a stale year behind it.',
  })
  annualSheet(@Query() query: AnnualSheetQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.getAnnualSheet(query, actor);
  }

  @Get('class-month')
  @RequirePermissions({ resource: 'scores', action: 'read' })
  @ApiOperation({
    summary: 'ສະຫຼຸບປະຈຳເດືອນ — one class, one month, every subject and a rank',
    description:
      "The columns are the subjects the class's grade is marked in, so a subject nobody has " +
      'filled in yet is an empty column rather than a missing one. ສະເລ່ຍ divides the marks ' +
      'by that number of subjects — 4 at ມ.1–ມ.3, 8 at ມ.4 and ມ.7, 7 at ມ.5 and ມ.6.',
  })
  classMonth(@Query() query: ClassMonthQueryDto) {
    return this.service.getClassMonth(query);
  }

  @Get('student')
  @RequirePermissions({ resource: 'scores', action: 'read' })
  @ApiOperation({
    summary: "One student's ຄະແນນປະຈຳເດືອນ — every month and every subject",
    description:
      'The class summary turned round: the months a term collects, the subjects the grade ' +
      'is marked in, and the ລຳດັບ the student held each month. Scoped like every other ' +
      'per-student read, so a guardian sees only their own child.',
  })
  studentMonths(@Query() query: StudentMonthsQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.getStudentMonths(query, actor);
  }

  @Post('month')
  @RequirePermissions({ resource: 'scores', action: 'create' })
  @ApiOperation({
    summary: 'Save one month of the grid for a whole class',
    description:
      'A column that is not sent keeps what it had; sent as `null` it is cleared back to ' +
      'unmarked, which is not a mark of zero. A row left blank on every column is removed.',
  })
  saveMonth(
    @Body() dto: SaveMonthGridDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.saveMonthGrid(dto, actor, ip);
  }

  @Post('term')
  @RequirePermissions({ resource: 'scores', action: 'create' })
  @ApiOperation({ summary: 'Save ສອບເສັງພາກ and ເພີ່ມ for a class' })
  saveTerm(
    @Body() dto: SaveTermMarksDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.saveTermMarks(dto, actor, ip);
  }

  @Post('month/lock')
  @RequirePermissions({ resource: 'scores', action: 'update' })
  @ApiOperation({ summary: 'Submit a month — further edits need it reopened' })
  lockMonth(
    @Body() dto: LockMonthDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.setMonthLock(dto, true, actor, ip);
  }

  @Post('month/unlock')
  @RequirePermissions({ resource: 'scores', action: 'manage' })
  @ApiOperation({
    summary: 'Reopen a submitted month',
    description: 'Requires a reason, which is recorded against the change.',
  })
  unlockMonth(
    @Body() dto: LockMonthDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.setMonthLock(dto, false, actor, ip);
  }
}
