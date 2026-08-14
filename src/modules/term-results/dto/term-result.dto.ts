import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsMongoId, IsOptional } from 'class-validator';
import { PaginationQueryDto } from 'src/common/dto/pagination.dto';

export class QueryTermResultsDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsMongoId() @IsOptional() studentId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() semesterId?: string;
  @ApiPropertyOptional() @IsMongoId() @IsOptional() classroomId?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;
}

export class ComputeTermResultsDto {
  @ApiProperty()
  @IsMongoId()
  classroomId: string;

  @ApiProperty()
  @IsMongoId()
  semesterId: string;
}

export class ComputeQueuedDto {
  @ApiProperty({ description: 'BullMQ job id; poll the job status endpoint with it' })
  jobId: string;

  @ApiProperty() classroomId: string;
  @ApiProperty() semesterId: string;
  @ApiProperty({ example: 'queued' }) status: string;
}
