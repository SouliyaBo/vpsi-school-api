import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from 'src/common/decorators';
import { AuditLogsService } from './audit-logs.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

@ApiTags('audit-logs')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly service: AuditLogsService) {}

  @Get()
  @RequirePermissions({ resource: 'audit-logs', action: 'read' })
  @ApiOperation({ summary: 'Search the audit trail' })
  findAll(@Query() query: QueryAuditLogsDto) {
    return this.service.findAll(query);
  }
}
