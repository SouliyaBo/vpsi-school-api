import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { LaoFontUnavailableError } from './pdf/font-resolver';
import { ReportsService } from './reports.service';

export const REPORTS_QUEUE = 'reports';
export const RENDER_REPORT_JOB = 'render-report';

export interface RenderReportJobData {
  reportId: string;
}

@Injectable()
export class ReportsQueueService {
  private readonly logger = new Logger(ReportsQueueService.name);

  constructor(@InjectQueue(REPORTS_QUEUE) private readonly queue: Queue) {}

  async enqueueRender(reportId: string): Promise<string> {
    const job = await this.queue.add(
      RENDER_REPORT_JOB,
      { reportId },
      {
        // One job per report row, so a double-submit renders once.
        jobId: `${RENDER_REPORT_JOB}:${reportId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600, count: 200 },
        removeOnFail: { age: 86400 },
      },
    );
    return job.id!;
  }

  async getJobStatus(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    return {
      jobId: job.id,
      state: await job.getState(),
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      result: job.returnvalue ?? null,
      failedReason: job.failedReason ?? null,
    };
  }
}

@Processor(REPORTS_QUEUE)
export class ReportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportsProcessor.name);

  constructor(private readonly reports: ReportsService) {
    super();
  }

  async process(job: Job<RenderReportJobData>): Promise<unknown> {
    if (job.name !== RENDER_REPORT_JOB) {
      throw new Error(`Unknown job name: ${job.name}`);
    }

    try {
      await job.updateProgress(10);
      const outcome = await this.reports.renderQueuedReport(job.data.reportId);
      await job.updateProgress(100);
      return outcome;
    } catch (error) {
      // A missing font is an environment problem: retrying cannot fix it, and
      // three attempts per report would bury the real cause in noise.
      if (error instanceof LaoFontUnavailableError) {
        this.logger.error(error.message);
        await job.discard();
      }
      throw error;
    }
  }
}
