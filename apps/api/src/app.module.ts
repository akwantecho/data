import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthorizationGuard } from './auth/guards/authorization.guard';
import { BranchesModule } from './branches/branches.module';
import { DepartmentsModule } from './departments/departments.module';
import { IndustriesModule } from './industries/industries.module';
import { OrganizationUsersModule } from './organization-users/organization-users.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { HealthModule } from './health/health.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PlatformModule } from './platform/platform.module';
import { PrismaModule } from './prisma/prisma.module';
import { validateEnv, type Env } from './config/env';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        // Authentication routes tighten this per-handler with @Throttle.
        throttlers: [
          { name: 'default', ttl: 60_000, limit: config.get('RATE_LIMIT', { infer: true }) },
        ],
        skipIf: () => !config.get('THROTTLE_ENABLED', { infer: true }),
      }),
    }),
    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
    IndustriesModule,
    OrganizationsModule,
    OrganizationUsersModule,
    BranchesModule,
    DepartmentsModule,
    PlatformModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: throttle, then authenticate, then authorise.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
  ],
})
export class AppModule {}
