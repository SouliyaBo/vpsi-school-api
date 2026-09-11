import { Injectable, Logger, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { SettingsService } from '../settings/settings.service';
import { DEFAULT_GRADE_SCALE, type GradeBand } from './grading';

/**
 * The grade boundaries, from `grading.scale` or the built-in scale.
 *
 * Its own tiny service for the same reason as `TermResultStalenessService`: the
 * term result is not the only thing that puts a letter on a mark — the monthly
 * class summary does too — and `MonthlyMarksModule` cannot import
 * `TermResultsModule`, which imports *it*. A second copy of the read would be a
 * second place for the school's scale to be wrong.
 */
@Injectable()
export class GradingScaleService {
  private readonly logger = new Logger(GradingScaleService.name);

  constructor(private readonly settings: SettingsService) {}

  async resolve(): Promise<readonly GradeBand[]> {
    const configured = await this.settings.getValue<GradeBand[]>('grading.scale');
    if (!Array.isArray(configured) || configured.length === 0) return DEFAULT_GRADE_SCALE;

    const isValid = configured.every(
      (band) =>
        typeof band?.grade === 'string' &&
        typeof band?.minPercentage === 'number' &&
        typeof band?.gradePoint === 'number',
    );
    if (!isValid) {
      this.logger.warn('Setting "grading.scale" is malformed; using the default scale');
      return DEFAULT_GRADE_SCALE;
    }

    // `gradeFor` takes the first matching band, so the scale must run high to low.
    return [...configured].sort((a, b) => b.minPercentage - a.minPercentage);
  }
}

@Module({
  imports: [SettingsModule],
  providers: [GradingScaleService],
  exports: [GradingScaleService],
})
export class GradingScaleModule {}
