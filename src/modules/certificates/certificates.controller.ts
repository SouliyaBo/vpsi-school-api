import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ClientIp, CurrentUser, Public, RequirePermissions } from 'src/common/decorators';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-user.interface';
import { CertificatesService } from './certificates.service';
import {
  CertificateVerificationDto,
  IssueCertificateDto,
  IssueStudyCertificateDto,
  QueryCertificatesDto,
  RevokeCertificateDto,
  StudyCertificatePrefillDto,
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

  @Get('study-verification/prefill/:studentId')
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'certificates', action: 'create' })
  @ApiOperation({
    summary: 'Draft values for a ໃບຢັ້ງຢືນການສຶກສາ',
    description:
      'What the register can answer for this pupil, plus `missing` — the fields it cannot. ' +
      'The school holds no birthplace for almost anyone on its roll, so expect to type that ' +
      'one. Anything left blank prints as a dotted run to be completed by hand.',
  })
  @ApiResponse({ status: 200, type: StudyCertificatePrefillDto })
  prefillStudyVerification(@Param('studentId') studentId: string) {
    return this.service.prefillStudyVerification(studentId);
  }

  @Post('study-verification/preview')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'certificates', action: 'create' })
  @ApiOperation({
    summary: 'Render a ໃບຢັ້ງຢືນການສຶກສາ without issuing it',
    description:
      'Streams the PDF. Allocates no number and writes no record, so the wording can be ' +
      'checked as often as needed; the number line reads `(ຮ່າງ)`.',
  })
  async previewStudyVerification(
    @Body() dto: IssueStudyCertificateDto,
    @Res() response: Response,
  ): Promise<void> {
    const pdf = await this.service.previewStudyVerification(dto);
    this.sendPdf(response, pdf, 'study-verification-draft.pdf');
  }

  @Post('study-verification')
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'certificates', action: 'create' })
  @ApiOperation({
    summary: 'Issue a ໃບຢັ້ງຢືນການສຶກສາ',
    description:
      "Allocates the next number in the school's outgoing-letter series, records the " +
      'written details and returns the PDF. Fields omitted from the body fall back to the ' +
      'register; an empty string clears one.',
  })
  async issueStudyVerification(
    @Body() dto: IssueStudyCertificateDto,
    @CurrentUser() actor: AuthenticatedUser,
    @ClientIp() ip: string | null,
    @Res() response: Response,
  ): Promise<void> {
    const { certificate, pdf } = await this.service.issueStudyVerification(dto, actor, ip);
    // The number is the one thing the caller cannot recompute, and it is already
    // spent by the time the bytes arrive.
    response.setHeader('X-Certificate-Number', encodeURIComponent(certificate.certificateNumber));
    response.setHeader('X-Certificate-Id', certificate._id.toString());
    this.sendPdf(
      response,
      pdf,
      `${certificate.certificateNumber.replace(/[^\p{L}\p{N}]+/gu, '-')}.pdf`,
    );
  }

  @Get(':id')
  @ApiBearerAuth()
  @RequirePermissions({ resource: 'certificates', action: 'read' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/file')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'The certificate PDF itself',
    description:
      'Streams the stored file, re-rendering it first if the record has none. Available to ' +
      'staff with `certificates:read`, and to the pupil or a linked guardian.',
  })
  async file(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const { pdf, filename } = await this.service.getFile(id, actor);
    this.sendPdf(response, pdf, filename);
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

  /**
   * `attachment` rather than `inline`: the letter is printed, signed and stamped
   * before it means anything, so the browser's PDF viewer is not the
   * destination.
   */
  private sendPdf(response: Response, pdf: Buffer, filename: string): void {
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Length', pdf.length);
    // The filename carries Lao characters, which a bare `filename=` cannot.
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    response.end(pdf);
  }
}
