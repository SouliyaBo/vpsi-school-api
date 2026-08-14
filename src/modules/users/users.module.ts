import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  // AuthModule re-exports the User and Role Mongoose models.
  imports: [AuthModule, RolesModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
