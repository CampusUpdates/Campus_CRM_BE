import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateInteractionDto } from './dto/create-interaction.dto';

@Injectable()
export class InteractionsService {
  constructor(private readonly prisma: PrismaService) {}

  async createInteraction(dto: CreateInteractionDto, createdById: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: dto.leadId },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    const interaction = await this.prisma.interaction.create({
      data: {
        leadId: dto.leadId,
        createdById,
        title: dto.title || 'TPC Note',
        description: dto.description,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            role: { select: { name: true } },
          },
        },
      },
    });

    await this.prisma.activityLog.create({
      data: {
        userId: createdById,
        activity: 'TPC',
        entityType: 'Interaction',
        entityId: interaction.id,
        description: `Logged interaction "${interaction.title}" for lead ${lead.firstName}`,
      },
    });

    return interaction;
  }

  async getInteractionsForLead(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    return this.prisma.interaction.findMany({
      where: { leadId },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
            role: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
