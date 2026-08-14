import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { TermResultsService } from './term-results.service';

export const TERM_RESULTS_QUEUE = 'term-results';
export const COMPUTE_CLASSROOM_JOB = 'compute-classroom';

export interface ComputeClassroomJobData {
  classroomId: string;
  semesterId: string;
  requestedBy?: { sub: string; username: string };
}

/**
 * Queues term-result computation.
 *
 * Computing a class means reading every score for every student, running the
 * grading formulas, then a second ranking pass — too slow to hold an HTTP
 * request open, and an operation the caller does not need to wait for.
 */
@Injectable()
export class TermResultsQueueService {
  private readonly logger = new Logger(TermResultsQueueService.name);

  constructor(@InjectQueue(TERM_RESULTS_QUEUE) private readonly queue: Queue) {}

  async enqueueClassroom(data: ComputeClassroomJobData): Promise<string> {
    const job = await this.queue.add(COMPUTE_CLASSROOM_JOB, data, {
      // Deterministic id: re-requesting the same classroom while a job is
      // pending reuses it instead of computing twice concurrently.
      jobId: `${COMPUTE_CLASSROOM_JOB}:${data.classroomId}:${data.semesterId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 3600, count: 100 },
      removeOnFail: { age: 86400 },
    });

    this.logger.log(`Queued term-result computation ${job.id}`);
    return job.id!;
  }

  /** Job state for the polling endpoint. */
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

/**
 * Worker for the term-results queue.
 *
 * Runs in-process in development and in the dedicated `worker` container in
 * docker-compose. Errors are rethrown so BullMQ applies its retry policy rather
 * than marking a failed computation as done.
 */
@Processor(TERM_RESULTS_QUEUE)
export class TermResultsProcessor extends WorkerHost {
  private readonly logger = new Logger(TermResultsProcessor.name);

  constructor(private readonly service: TermResultsService) {
    super();
  }

  async process(job: Job<ComputeClassroomJobData>): Promise<unknown> {
    if (job.name !== COMPUTE_CLASSROOM_JOB) {
      throw new Error(`Unknown job name: ${job.name}`);
    }

    this.logger.log(`Processing ${job.id} for classroom ${job.data.classroomId}`);
    await job.updateProgress(10);

    const summary = await this.service.computeForClassroom(
      job.data.classroomId,
      job.data.semesterId,
      job.data.requestedBy,
    );

    await job.updateProgress(100);
    return summary;
  }
}
