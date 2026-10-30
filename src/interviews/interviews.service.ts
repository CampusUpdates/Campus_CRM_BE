import { Injectable, NotFoundException } from '@nestjs/common';
import { CandidateStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateInterviewDto } from './dto/create-interview.dto';
import { UpdateInterviewDto } from './dto/update-interview.dto';

@Injectable()
export class InterviewsService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createInterviewDto: CreateInterviewDto) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: createInterviewDto.candidateId },
    });

    if (!candidate) {
      throw new NotFoundException('Candidate not found.');
    }

    const interviewer = await this.prisma.user.findUnique({
      where: { id: createInterviewDto.interviewerId },
    });

    if (!interviewer) {
      throw new NotFoundException('Interviewer not found.');
    }

    const interview = await this.prisma.interview.create({
      data: {
        candidateId: createInterviewDto.candidateId,
        interviewerId: createInterviewDto.interviewerId,
        scheduledAt: createInterviewDto.scheduledAt,
        status: createInterviewDto.status || 'SCHEDULED',
        result: createInterviewDto.result || 'PENDING',
        feedback: createInterviewDto.feedback,
      },
      include: {
        candidate: {
          include: {
            position: true,
          },
        },
        interviewer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    // Update candidate status to INTERVIEW_SCHEDULED if APPLIED or SCREENING
    if (candidate.status === 'APPLIED' || candidate.status === 'SCREENING') {
      await this.prisma.candidate.update({
        where: { id: candidate.id },
        data: { status: 'INTERVIEW_SCHEDULED' },
      });
    }

    return interview;
  }

  async findAll() {
    return this.prisma.interview.findMany({
      orderBy: {
        scheduledAt: 'desc',
      },
      include: {
        candidate: {
          include: {
            position: true,
          },
        },
        interviewer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const interview = await this.prisma.interview.findUnique({
      where: { id },
      include: {
        candidate: {
          include: {
            position: true,
          },
        },
        interviewer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!interview) {
      throw new NotFoundException('Interview not found.');
    }

    return interview;
  }

  async update(id: string, updateInterviewDto: UpdateInterviewDto) {
    const existing = await this.prisma.interview.findUnique({
      where: { id },
      include: { candidate: true },
    });

    if (!existing) {
      throw new NotFoundException('Interview session not found.');
    }

    if (updateInterviewDto.interviewerId) {
      const interviewer = await this.prisma.user.findUnique({
        where: { id: updateInterviewDto.interviewerId },
      });

      if (!interviewer) {
        throw new NotFoundException('Assigned interviewer not found.');
      }
    }

    const updatedInterview = await this.prisma.interview.update({
      where: { id },
      data: {
        interviewerId: updateInterviewDto.interviewerId,
        scheduledAt: updateInterviewDto.scheduledAt,
        status: updateInterviewDto.status,
        result: updateInterviewDto.result,
        feedback: updateInterviewDto.feedback,
      },
      include: {
        candidate: {
          include: {
            position: true,
          },
        },
        interviewer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    });

    // Synchronize Candidate Status based on Interview Status & Result
    const newResult = updatedInterview.result;
    const newStatus = updatedInterview.status;
    let targetCandidateStatus: CandidateStatus | null = null;

    if (newResult === 'PASSED') {
      targetCandidateStatus = 'SELECTED';
    } else if (newResult === 'FAILED') {
      targetCandidateStatus = 'REJECTED';
    } else if (newStatus === 'COMPLETED') {
      targetCandidateStatus = 'INTERVIEWED';
    } else if (newStatus === 'SCHEDULED') {
      targetCandidateStatus = 'INTERVIEW_SCHEDULED';
    } else if (newStatus === 'CANCELLED') {
      targetCandidateStatus = 'SCREENING';
    }

    if (targetCandidateStatus) {
      await this.prisma.candidate.update({
        where: { id: existing.candidateId },
        data: { status: targetCandidateStatus },
      });
    }

    return updatedInterview;
  }
}
