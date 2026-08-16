import { Module } from '@nestjs/common';
import { OrganizationUsersController } from './organization-users.controller';
import { OrganizationUsersService } from './organization-users.service';

@Module({
  controllers: [OrganizationUsersController],
  providers: [OrganizationUsersService],
})
export class OrganizationUsersModule {}
