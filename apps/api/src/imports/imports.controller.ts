import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type {
  ImportCommitResult,
  ImportPreview,
  ImportRowDetail,
  ImportSummary,
  ImportValidationReport,
  Paginated,
} from '@sip/shared-types';
import { memoryStorage } from 'multer';
import { ApiException } from '../common/errors/api-exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser, OrganizationId, Roles } from '../auth/decorators';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  importMappingSchema,
  listImportsSchema,
  listRowsSchema,
  uploadImportSchema,
  type ImportMappingDto,
  type ListImportsDto,
  type ListRowsDto,
  type UploadImportDto,
} from './imports.dto';
import { ImportsService } from './imports.service';

/** Upload ceiling. Anything larger belongs in an asynchronous pipeline. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = [
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel', // what Windows reports for .csv
  'application/octet-stream',
];

@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /**
   * Step 1 — upload and parse. The file is held in memory, never written to disk,
   * and only its parsed rows are persisted.
   */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      fileFilter: (_request, file, callback) => {
        const hasCsvExtension = file.originalname.toLowerCase().endsWith('.csv');

        if (!hasCsvExtension || !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          callback(new BadRequestException('Only .csv files can be imported.'), false);
          return;
        }

        callback(null, true);
      },
    }),
  )
  upload(
    @OrganizationId() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(uploadImportSchema)) body: UploadImportDto,
    @Ip() ip: string,
  ): Promise<ImportPreview> {
    if (!file) {
      throw ApiException.validation('The request could not be processed.', [
        { field: 'file', message: 'A CSV file is required' },
      ]);
    }

    return this.imports.upload(organizationId, user.id, file, body.dataSourceId, ip);
  }

  /** Step 2 — say which column fills each importer field. */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post(':id/map')
  @HttpCode(HttpStatus.OK)
  map(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(importMappingSchema)) dto: ImportMappingDto,
    @Ip() ip: string,
  ): Promise<ImportSummary> {
    return this.imports.setMapping(organizationId, id, user.id, dto, ip);
  }

  /** Step 3 — check every row and record what is wrong with it. */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  validate(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ImportValidationReport> {
    return this.imports.validate(organizationId, id);
  }

  /** Step 4 — write the accepted rows into metric values. */
  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post(':id/commit')
  @HttpCode(HttpStatus.OK)
  commit(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ): Promise<ImportCommitResult> {
    return this.imports.commit(organizationId, id, user.id, ip);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
  ): Promise<ImportSummary> {
    return this.imports.cancel(organizationId, id, user.id, ip);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get()
  list(
    @OrganizationId() organizationId: string,
    @Query(new ZodValidationPipe(listImportsSchema)) query: ListImportsDto,
  ): Promise<Paginated<ImportSummary>> {
    return this.imports.list(organizationId, query.page, query.pageSize);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get(':id')
  findOne(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ImportValidationReport> {
    return this.imports.findSummary(organizationId, id);
  }

  @Roles('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER')
  @Get(':id/rows')
  listRows(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(listRowsSchema)) query: ListRowsDto,
  ): Promise<Paginated<ImportRowDetail>> {
    return this.imports.listRows(organizationId, id, query);
  }
}
