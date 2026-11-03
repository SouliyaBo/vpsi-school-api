import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClientIp, CurrentUser, Public, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  CreateGuardianReportDto,
  GuardianReportDraftQueryDto,
  OpenGuardianReportDto,
  QueryGuardianReportsDto,
} from './dto/guardian-report.dto';
import { GuardianReportsService } from './guardian-reports.service';

@ApiTags('guardian-reports')
@Controller('guardian-reports')
export class GuardianReportsController {
  constructor(private readonly service: GuardianReportsService) {}

  /**
   * Public: a guardian has no account. What stands in for one is the token in
   * the link's fragment and the last four digits of their phone, posted in the
   * body so neither ever sits in a URL, a proxy log or the browser history.
   * Throttled well below the global limit, on top of the five guesses a link
   * survives.
   */
  @Public()
  @Post('open')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  @ApiOperation({
    summary: 'Open a report from its link',
    description:
      'Returns the frozen report when `pin` is the last four digits of the addressed ' +
      'guardian’s phone. Unknown, expired and revoked links, and links whose child or ' +
      'guardian is no longer on file, all answer `guardianReport.unavailable`; the fifth ' +
      'wrong guess answers `guardianReport.locked` for good.',
  })
  open(@Body() dto: OpenGuardianReportDto, @ClientIp() ip: string | null) {
    return this.service.open(dto, ip);
  }

  @Get('draft')
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'guardian-reports', action: 'create' })
  @ApiOperation({
    summary: 'Preview a month’s report for one child, with every section filled',
    description:
      'For the homeroom teacher of the child’s room, or `manage`. Lists every linked guardian, ' +
      'including the ones a report cannot go to, with the reason.',
  })
  draft(@Query() query: GuardianReportDraftQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.draft(query, actor);
  }

  @Get()
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'guardian-reports', action: 'read' })
  @ApiOperation({
    summary: 'Reports sent about one child',
    description: 'The homeroom teacher of the child’s room, or `manage`. Never returns a token.',
  })
  list(@Query() query: QueryGuardianReportsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.list(query, actor);
  }

  @Post()
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'guardian-reports', action: 'create' })
  @ApiOperation({
    summary: 'ສົ່ງລາຍງານຫາຜູ້ປົກຄອງ',
    description:
      'Freezes the report and returns `token` — the only time it is ever returned. The ' +
      'client builds the link as `<origin>/r#<token>`.',
  })
  create(
    @Body() dto: CreateGuardianReportDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, actor, ip);
  }

  @Post(':id/reissue')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'guardian-reports', action: 'create' })
  @ApiOperation({
    summary: 'A new link for a report already sent',
    description:
      'The old link stops working; wrong guesses and the expiry start again. Not for a ' +
      'revoked report.',
  })
  reissue(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.reissue(id, actor, ip);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'guardian-reports', action: 'delete' })
  @ApiOperation({ summary: 'Stop a link for good' })
  revoke(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.revoke(id, actor, ip);
  }
}
