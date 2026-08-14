import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { ConductScoresService } from './conduct-scores.service';
import { QueryConductScoresDto, UpsertConductScoreDto } from './dto/conduct-score.dto';

@ApiTags('conduct-scores')
@ApiBearerAuth()
@Controller('conduct-scores')
export class ConductScoresController {
  constructor(private readonly service: ConductScoresService) {}

  @Get()
  @RequirePermissions({ resource: 'conduct-scores', action: 'read' })
  findAll(@Query() query: QueryConductScoresDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.findAll(query, actor);
  }

  @Put()
  @RequirePermissions({ resource: 'conduct-scores', action: 'create' })
  @ApiOperation({
    summary: 'Record or replace a conduct score for one period',
    description:
      'Idempotent per (student, semester, periodType, periodValue). The letter grade is ' +
      'derived from the numeric score, never taken from the request.',
  })
  upsert(
    @Body() dto: UpsertConductScoreDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.upsert(dto, actor, ip);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'conduct-scores', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, actor, ip);
  }
}
