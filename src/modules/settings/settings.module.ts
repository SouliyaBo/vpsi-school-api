import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Setting, SettingSchema } from 'src/database/schemas';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/** Global: grading, locale, and school settings are consulted from many modules. */
@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: Setting.name, schema: SettingSchema }])],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
