import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePositionDto } from './dto/create-positions.dto';

@Injectable()
export class PositionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const positions = await this.prisma.position.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        _count: {
          select: { candidates: true },
        },
      },
    });

    return positions;
  }

  async create(createPositionDto: CreatePositionDto) {
    const existingPosition = await this.prisma.position.findUnique({
      where: {
        title: createPositionDto.title,
      },
    });

    if (existingPosition) {
      throw new ConflictException('Position already exists.');
    }

    const position = await this.prisma.position.create({
      data: {
        title: createPositionDto.title,
        department: createPositionDto.department,
        description: createPositionDto.description,
        vacancies: createPositionDto.vacancies ?? 1,
        isActive: createPositionDto.isActive ?? true,
      },
    });

    return position;
  }
}
