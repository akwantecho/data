import { Injectable } from '@nestjs/common';
import type { HealthCheckResponse } from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { APP_VERSION } from '../common/version';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthCheckResponse> {
    const databaseUp = await this.prisma.isReachable();

    return {
      status: databaseUp ? 'ok' : 'degraded',
      service: 'strategic-intelligence-api',
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database: databaseUp ? 'up' : 'down' },
      timestamp: new Date().toISOString(),
    };
  }
}
