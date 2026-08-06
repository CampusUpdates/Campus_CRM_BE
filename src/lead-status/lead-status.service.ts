import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateLeadStatusDto } from './dto/create-lead-status.dto';

@Injectable()
export class LeadStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createLeadStatusDto: CreateLeadStatusDto) {
    const existingLeadStatus = await this.prisma.leadStatus.findUnique({
      where: {
        name: createLeadStatusDto.name,
      },
    });

    if (existingLeadStatus) {
      throw new ConflictException('Lead status already exists.');
    }

    const leadStatus = await this.prisma.leadStatus.create({
      data: {
        name: createLeadStatusDto.name,
        description: createLeadStatusDto.description,
        displayOrder: createLeadStatusDto.displayOrder,
        color: createLeadStatusDto.color,
      },
    });

    return leadStatus;
  }

  async findAll() {
    const leadStatuses = await this.prisma.leadStatus.findMany({
      orderBy: {
        displayOrder: 'asc',
      },
    });

    return leadStatuses;
  }
}