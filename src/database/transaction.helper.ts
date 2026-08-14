import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ClientSession, Connection } from 'mongoose';

/**
 * Runs work inside a MongoDB multi-document transaction.
 *
 * Requires a replica set — `docker-compose.yml` runs mongo with `--replSet rs0`
 * for exactly this reason. `withTransaction` retries transient transaction
 * errors and commit-unknown-result errors internally, which is why it is
 * preferred over manual start/commit/abort.
 */
@Injectable()
export class TransactionHelper {
  private readonly logger = new Logger(TransactionHelper.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async run<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let result: T;
      await session.withTransaction(async () => {
        result = await work(session);
      });
      // Safe: withTransaction rethrows on failure, so reaching here means the
      // callback ran to completion at least once.
      return result!;
    } finally {
      await session.endSession();
    }
  }
}
