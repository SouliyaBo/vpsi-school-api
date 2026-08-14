import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppConfig } from 'src/config/configuration';
import { TransactionModule } from './transaction.module';

@Global()
@Module({
  imports: [
    TransactionModule,
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const logger = new Logger('MongooseModule');
        return {
          uri: config.get('MONGODB_URI', { infer: true }),
          // Fail fast on a wrong URI rather than hanging for the 30 s default.
          serverSelectionTimeoutMS: 5000,
          // Build the indexes declared in the schemas. Cheap in this dataset's
          // size range and keeps dev/CI databases correct without a migration step.
          autoIndex: true,
          onConnectionCreate: () => {
            logger.log('Connected to MongoDB');
          },
        };
      },
    }),
  ],
  exports: [TransactionModule],
})
export class DatabaseModule {}
