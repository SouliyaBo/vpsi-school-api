import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  BookCountQueryDto,
  CreateBookLoanDto,
  CreateBookTitleDto,
  LendablesQueryDto,
  QueryBookLoansDto,
  QueryBookTitlesDto,
  ReturnBookLoanDto,
  SaveBookCountDto,
  SaveWorkbookSaleDto,
  UpdateBookTitleDto,
  WorkbookSaleQueryDto,
} from './dto/library.dto';
import { LibraryService } from './library.service';

/**
 * ຄັງປື້ມ — ຄູ່ມືຄູ, ແບບຮຽນ, ປື້ມອຸປະຖຳ, ເອກະສານອ້າງອີງ, the loans against the
 * titles, and ການສ້າງປື້ມແບບບົດເຝິກຫັດອອກຂາຍ.
 */
@ApiTags('library')
@ApiBearerAuth()
@Controller('library')
export class LibraryController {
  constructor(private readonly service: LibraryService) {}

  // ── Counts ──

  @Get('counts')
  @RequirePermissions({ resource: 'library', action: 'read' })
  @ApiOperation({
    summary: 'ຄູ່ມືຄູ / ແບບຮຽນ — copies per subject and grade for one school year',
    description: 'Totals by row, by grade and overall are worked out from the cells on every read.',
  })
  getCounts(@Query() query: BookCountQueryDto) {
    return this.service.getCounts(query);
  }

  @Put('counts')
  @RequirePermissions({ resource: 'library', action: 'update' })
  @ApiOperation({ summary: 'Save the whole count sheet — every row is replaced' })
  saveCounts(
    @Body() dto: SaveBookCountDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.saveCounts(dto, actor, ip);
  }

  // ── Titles ──

  @Get('titles')
  @RequirePermissions({ resource: 'library', action: 'read' })
  @ApiOperation({
    summary: 'ປື້ມອຸປະຖຳ / ເອກະສານອ້າງອີງ — titles, with copies on loan and on the shelf',
  })
  findTitles(@Query() query: QueryBookTitlesDto) {
    return this.service.findTitles(query);
  }

  @Get('titles/summary')
  @RequirePermissions({ resource: 'library', action: 'read' })
  @ApiOperation({ summary: 'Titles, copies, value and loans — overall and per source' })
  titleSummary(@Query() query: QueryBookTitlesDto) {
    return this.service.titleSummary(query.category);
  }

  @Post('titles')
  @RequirePermissions({ resource: 'library', action: 'create' })
  createTitle(
    @Body() dto: CreateBookTitleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.createTitle(dto, actor, ip);
  }

  @Patch('titles/:id')
  @RequirePermissions({ resource: 'library', action: 'update' })
  @ApiOperation({ description: 'Copies cannot be cut below the number currently on loan.' })
  updateTitle(
    @Param('id') id: string,
    @Body() dto: UpdateBookTitleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.updateTitle(id, dto, actor, ip);
  }

  @Delete('titles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'library', action: 'delete' })
  @ApiOperation({ description: 'Refused while any copy is still on loan.' })
  removeTitle(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.removeTitle(id, actor, ip);
  }

  // ── Loans ──

  @Get('lendables')
  @RequirePermissions({ resource: 'library', action: 'read' })
  @ApiOperation({
    summary: 'Books that can be lent, for the loan picker',
    description:
      'Titles, and every cell of the active year’s ຄູ່ມືຄູ / ແບບຮຽນ sheets, each with the copies ' +
      'on the shelf. A key names the book: `t:<titleId>` or `c:<sheetId>:<rowId>:<gradeLevelId>`.',
  })
  lendables(@Query() query: LendablesQueryDto) {
    return this.service.lendables(query.search);
  }

  @Get('loans')
  @RequirePermissions({ resource: 'library', action: 'read' })
  @ApiOperation({ summary: 'ການຢືມ — outstanding first, oldest at the top' })
  findLoans(@Query() query: QueryBookLoansDto) {
    return this.service.findLoans(query);
  }

  @Post('loans')
  @RequirePermissions({ resource: 'library', action: 'create' })
  @ApiOperation({
    summary: 'Lend copies of a title',
    description:
      'Refused when fewer copies are on the shelf than asked for. A teacher or student is ' +
      'checked against the register; `other` takes a name by hand.',
  })
  createLoan(
    @Body() dto: CreateBookLoanDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.createLoan(dto, actor, ip);
  }

  @Post('loans/:id/return')
  @RequirePermissions({ resource: 'library', action: 'update' })
  @ApiOperation({ summary: 'ສົ່ງຄືນ — record the copies as back on the shelf' })
  returnLoan(
    @Param('id') id: string,
    @Body() dto: ReturnBookLoanDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.returnLoan(id, dto, actor, ip);
  }

  // ── Workbook sales ──

  @Get('workbook-sales')
  @RequirePermissions({ resource: 'library', action: 'read' })
  @ApiOperation({
    summary: 'ການສ້າງປື້ມແບບບົດເຝິກຫັດອອກຂາຍ — one school year, with its totals',
  })
  getWorkbookSales(@Query() query: WorkbookSaleQueryDto) {
    return this.service.getWorkbookSales(query);
  }

  @Put('workbook-sales')
  @RequirePermissions({ resource: 'library', action: 'update' })
  @ApiOperation({ summary: 'Save the year’s printing and sales — sent whole' })
  saveWorkbookSales(
    @Body() dto: SaveWorkbookSaleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.saveWorkbookSales(dto, actor, ip);
  }
}
