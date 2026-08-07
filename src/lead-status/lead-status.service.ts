import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateLeadStatusDto } from './dto/create-lead-status.dto';

@Injectable()
export class LeadStatusService {
  constructor(private readonly prisma: PrismaService) {}

  //find leadstatus
  async findAll() {
    const leadStatuses = await this.prisma.leadStatus.findMany({
      orderBy: {
        displayOrder: 'asc',
      },
    });

    return leadStatuses;
  }
  //create leadstatus
  async create(createLeadStatusDto: CreateLeadStatusDto) {
    const existingLeadStatus = await this.prisma.leadStatus.findUnique({
      where: {
        name: createLeadStatusDto.name,
      },
    });

    if (existingLeadStatus) {
      throw new ConflictException('Lead status already exists.');
    }
    const lastOrder = await this.prisma.leadStatus.findFirst({
      orderBy:{
        displayOrder: 'desc'
      }
    })
    const nextDisplayOrder = lastOrder ? lastOrder.displayOrder + 1: 1
    const leadStatus = await this.prisma.leadStatus.create({
      data: {
        name: createLeadStatusDto.name,
        description: createLeadStatusDto.description,
        displayOrder: nextDisplayOrder,
        color: createLeadStatusDto.color,
      },
    });

    return leadStatus;
  }
}