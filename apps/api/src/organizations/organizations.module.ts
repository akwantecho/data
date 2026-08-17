import { Module } from '@nestjs/common';
import { IndustryPacksModule } from '../industry-packs/industry-packs.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [IndustryPacksModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
