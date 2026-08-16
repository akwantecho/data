import { Injectable } from '@nestjs/common';
import type { IndustrySummary } from '@sip/shared-types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Industries are platform-level reference data, not tenant data: every
 * organization chooses from the same list, and the list carries nothing private.
 */
@Injectable()
export class IndustriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<IndustrySummary[]> {
    const industries = await this.prisma.industry.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, description: true },
    });

    return industries;
  }
}
