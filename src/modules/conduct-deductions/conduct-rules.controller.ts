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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentUser, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { ConductRulesService } from './conduct-rules.service';
import {
  CreateConductRuleDto,
  QueryConductRulesDto,
  UpdateConductRuleDto,
} from './dto/conduct-deduction.dto';

/**
 * ລະບຽບການຕັດຄະແນນ — the published rule sheet.
 *
 * Readable by anyone who may see conduct at all, because a child cannot be held
 * to a rule they are not allowed to read. Writing it needs `manage`: the sheet
 * is issued over the director's signature, so the office edits it and a teacher
 * applies it.
 */
@ApiTags('conduct-rules')
@ApiBearerAuth()
@Controller('conduct-rules')
export class ConductRulesController {
  constructor(private readonly service: ConductRulesService) {}

  @Get()
  @RequirePermissions({ resource: 'conduct-scores', action: 'read' })
  @ApiOperation({
    summary: 'The sheet in force, in its printed order',
    description: 'Cheapest column first. `includeWithdrawn` also returns retired rules.',
  })
  findAll(@Query() query: QueryConductRulesDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions({ resource: 'conduct-scores', action: 'read' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions({ resource: 'conduct-scores', action: 'manage' })
  create(
    @Body() dto: CreateConductRuleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.create(dto, { actor, ip });
  }

  @Patch(':id')
  @RequirePermissions({ resource: 'conduct-scores', action: 'manage' })
  @ApiOperation({
    summary: 'Amend a rule',
    description:
      'Rewording one does not rewrite the deductions already taken under it: each row keeps ' +
      'the wording it was applied with.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateConductRuleDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.update(id, dto, { actor, ip });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions({ resource: 'conduct-scores', action: 'manage' })
  @ApiOperation({
    summary: 'Delete a rule nobody has been deducted under',
    description: 'One that has been applied is withdrawn with `isActive: false` instead.',
  })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.remove(id, { actor, ip });
  }
}
