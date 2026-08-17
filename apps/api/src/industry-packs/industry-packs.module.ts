import { Module } from '@nestjs/common';
import { IndustryPacksController } from './industry-packs.controller';
import { IndustryPacksService } from './industry-packs.service';
import { PackInstallerService } from './pack-installer.service';
import { PlatformPacksController } from './platform-packs.controller';

@Module({
  controllers: [IndustryPacksController, PlatformPacksController],
  providers: [IndustryPacksService, PackInstallerService],
  exports: [PackInstallerService, IndustryPacksService],
})
export class IndustryPacksModule {}
