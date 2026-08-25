import { Injectable, Logger, Module } from '@nestjs/common';
import { InjectModel, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TermResult, TermResultDocument, TermResultSchema } from 'src/database/schemas';

/** What a term result was recomputed from, for the audit trail. */
export interface StaleTarget {
  studentIds?: (Types.ObjectId | string)[];
  classroomId?: Types.ObjectId | string;
  semesterId: Types.ObjectId | string;
}

/**
 * Flags stored term results as out of date when a mark changes underneath them.
 *
 * A term result is derived and stored: computing it is an explicit act, so from
 * the moment a teacher corrects a cell the stored figure is wrong and nothing in
 * the system says so. That is the quiet failure this exists to make loud — the
 * office sees which classes are waiting on a recomputation rather than finding
 * out from a parent.
 *
 * Deliberately its own tiny service, in its own module holding nothing but the
 * `TermResult` model: the mark-entry modules can depend on it without depending
 * on `TermResultsModule`, which depends on *them*. Anything richer here would be
 * a dependency cycle.
 *
 * Never throws into a caller. A mark that saved must not be rolled back because
 * a flag could not be raised; the failure is logged and the recomputation the
 * office runs anyway will put the figures right.
 */
@Injectable()
export class TermResultStalenessService {
  private readonly logger = new Logger(TermResultStalenessService.name);

  constructor(@InjectModel(TermResult.name) private readonly model: Model<TermResultDocument>) {}

  async markStale(target: StaleTarget, reason: string): Promise<number> {
    const filter: Record<string, unknown> = {
      semesterId: new Types.ObjectId(target.semesterId.toString()),
      deletedAt: null,
      // Only the first change moves `staleSince`, so the office can see how long
      // a class has been waiting rather than how recently it was touched.
      isStale: false,
    };

    if (target.studentIds?.length) {
      filter.studentId = { $in: target.studentIds.map((id) => new Types.ObjectId(id.toString())) };
    }
    if (target.classroomId) {
      filter.classroomId = new Types.ObjectId(target.classroomId.toString());
    }

    try {
      const outcome = await this.model
        .updateMany(filter, { $set: { isStale: true, staleSince: new Date() } })
        .exec();

      if (outcome.modifiedCount > 0) {
        this.logger.log(
          `${outcome.modifiedCount} term result(s) now stale: ${reason} ` +
            `(semester ${target.semesterId.toString()})`,
        );
      }
      return outcome.modifiedCount;
    } catch (error) {
      this.logger.error(
        `Could not flag term results as stale after ${reason}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    }
  }
}

/**
 * The model and the service, and nothing else.
 *
 * Imported by every module that writes a mark. Kept free of the rest of
 * `TermResultsModule` so those imports cannot become a cycle.
 */
@Module({
  imports: [MongooseModule.forFeature([{ name: TermResult.name, schema: TermResultSchema }])],
  providers: [TermResultStalenessService],
  exports: [TermResultStalenessService],
})
export class TermResultStalenessModule {}
