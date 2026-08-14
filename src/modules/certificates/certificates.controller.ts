import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClientIp, CurrentUser, Public, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { CertificatesService } from './certificates.service';
import {
  CertificateVerificationDto,
  IssueCertificateDto,
  QueryCertificatesDto,
  RevokeCertificateDto,
} from './dto/certificate.dto';

@ApiTags('certificates')
@Controller('certificates')
export class CertificatesController {
  constructor(private readonly service: CertificatesService) {}

  /**
   * Public so an employer or university can check a certificate presented to
   * them. Rate-limited tightly, since it is the one unauthenticated lookup that
   * touches student records — even reduced to a name.
   */
  @Public()
  @Get('verify/:certificateNumber')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify a certificate number',
    description:
      'Confirms whether a number is genuine and names the holder. Exposes no marks or ' +
      'contact details. An unknown number returns `isValid: false` rather than 404, so a ' +
      'typo and a forgery are indistinguishable from outside.',
  })
  @ApiResponse({ status: 200, type: CertificateVerificationDto })
  verify(@Param('certificateNumber') certificateNumber: string) {
    return this.service.verify(certificateNumber);
  }

  @Get()
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'certificates', action: 'read' })
  findAll(@Query() query: QueryCertificatesDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'certificates', action: 'read' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/download')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Signed download URL for the certificate PDF',
    description:
      'Available to staff with `certificates:read`, and to the student or a linked guardian.',
  })
  download(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.getDownloadUrl(id, actor);
  }

  @Post()
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'certificates', action: 'create' })
  @ApiOperation({
    summary: 'Issue a certificate',
    description:
      'Allocates the next number in the `<year>/<TYPE>/<ordinal>` series, then renders the ' +
      'PDF. The number is committed before rendering, so a rendering failure cannot leave a ' +
      'gap in the series — use `regenerate` to produce the missing file.',
  })
  issue(
    @Body() dto: IssueCertificateDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.issue(dto, actor, ip);
  }

  @Post(':id/regenerate')
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'certificates', action: 'manage' })
  @ApiOperation({ summary: 'Re-render the PDF for an existing certificate' })
  regenerate(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.regenerateFile(id, actor);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'certificates', action: 'manage' })
  @ApiOperation({
    summary: 'Revoke a certificate',
    description:
      'The record is retained and flagged, not deleted — a number that has circulated must ' +
      'stay verifiable, and "revoked" is a different answer from "never existed".',
  })
  revoke(
    @Param('id') id: string,
    @Body() dto: RevokeCertificateDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
  ) {
    return this.service.revoke(id, dto, actor, ip);
  }
}
