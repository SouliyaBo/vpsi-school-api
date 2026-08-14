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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import {
  CreateScoreComponentDto,
  QueryScoreComponentsDto,
  UpdateScoreComponentDto,
  WeightSummaryDto,
} from './dto/score-component.dto';
import { ScoreComponentsService } from './score-components.service';

@ApiTags('score-components')
@ApiBearerAuth()
@Controller('score-components')
export class ScoreComponentsController {
  constructor(private readonly service: ScoreComponentsService) {}

  @Get()
  @RequirePermissions({ resource: 'score-components', action: 'read' })
  findAll(@Query() query: QueryScoreComponentsDto) {
    return this.service.findAll(query);
  }

  @Get('weight-summary')
  @RequirePermissions({ resource: 'score-components', action: 'read' })
  @ApiQuery({ name: 'subjectId', required: true })
  @ApiQuery({ name: 'semesterId', required: true })
  @ApiQuery({ name: 'classroomId', required: false })
  @ApiOperation({
    summary: 'Check whether component weights total 100%',
    description:
      'Weights are not forced to total 100 on every write — a teacher builds components up ' +
      'incrementally. The total is enforced when term results are computed; this endpoint ' +
      'lets the UI warn beforehand.',
  })
  @ApiResponse({ status: 200, type: WeightSummaryDto })
  weightSummary(
    @Query('subjectId') subjectId: string,
    @Query('semesterId') semesterId: string,
    @Query('classroomId') classroomId?: string,
  ) {
    return this.service.getWeightSummary(subjectId, semesterId, classroomId);
  }

  @Get(':id')
  @RequirePermissions({ resource: 'score-components', action: 'read' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions({ resource: 'score-components', action: 'create' })
  @ApiOperation({ summary: 'Define a gradeable component; rejected if it would exceed 100%' })
  create(
    @Body() dto: CreateScoreComponentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'score-components', action: 'update' })
  @ApiOperation({
    summary: 'Update a component',
    description: '`maxScore` is immutable once any score has been recorded against it.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateScoreComponentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, { actor, ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'score-components', action: 'delete' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
