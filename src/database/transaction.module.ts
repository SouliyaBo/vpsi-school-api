import { Global, Module } from '@nestjs/common';
import { TransactionHelper } from './transaction.helper';

/**
 * Provides TransactionHelper application-wide.
 *
 * Separate from DatabaseModule so tests — which supply their own Mongoose root
 * connection — can import the helper without also pulling in the production
 * connection factory.
 */
@Global()
@Module({
  providers: [TransactionHelper],
  exports: [TransactionHelper],
})
export class TransactionModule {}
