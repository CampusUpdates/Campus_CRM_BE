import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateCandidateDto } from './dto/create-candidate.dto';

@Injectable()
export class CandidatesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createCandidateDto: CreateCandidateDto) {
    const position = await this.prisma.position.findUnique({
      where: { id: createCandidateDto.positionId },
    });

    if (!position) {
      throw new NotFoundException('Position not found.');
    }

    // Check unique phone
    const existingPhone = await this.prisma.candidate.findUnique({
      where: { phone: createCandidateDto.phone },
    });

    if (existingPhone) {
      throw new ConflictException(
        'Candidate with this phone number already exists.',
      );
    }

    // Check unique email if provided
    if (createCandidateDto.email) {
      const existingEmail = await this.prisma.candidate.findUnique({
        where: { email: createCandidateDto.email },
      });

      if (existingEmail) {
        throw new ConflictException(
          'Candidate with this email address already exists.',
        );
      }
    }

    const candidate = await this.prisma.candidate.create({
      data: {
        positionId: createCandidateDto.positionId,
        firstName: createCandidateDto.firstName,
        lastName: createCandidateDto.lastName,
        phone: createCandidateDto.phone,
        alternatePhone: createCandidateDto.alternatePhone,
        email: createCandidateDto.email,
        gender: createCandidateDto.gender,
        dateOfBirth: createCandidateDto.dateOfBirth,
        resumeUrl: createCandidateDto.resumeUrl,
        experience: createCandidateDto.experience,
        currentCompany: createCandidateDto.currentCompany,
        status: createCandidateDto.status || 'APPLIED',
      },
      include: {
        position: true,
      },
    });

    return candidate;
  }

  async findAll() {
    return this.prisma.candidate.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        position: true,
      },
    });
  }

  async findOne(id: string) {
    const candidate = await this.prisma.candidate.findUnique({
      where: { id },
      include: {
        position: true,
        interviews: true,
      },
    });

    if (!candidate) {
      throw new NotFoundException('Candidate not found.');
    }

    return candidate;
  }
}
