import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Location, LocationSchema } from 'src/database/schemas';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Location.name, schema: LocationSchema }])],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService, MongooseModule],
})
export class LocationsModule {}
