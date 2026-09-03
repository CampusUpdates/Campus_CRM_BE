import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateCollegeDto } from './dto/create-college.dto';
import { UpdateCollegeDto } from './dto/update-college.dto';

@Injectable()
export class CollegesService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createCollegeDto: CreateCollegeDto) {
    const existingCollege = await this.prisma.college.findUnique({
      where: { name: createCollegeDto.name },
    });

    if (existingCollege) {
      throw new ConflictException('College with this name already exists');
    }

    return this.prisma.college.create({
      data: createCollegeDto,
    });
  }

  async findAll(query?: {
    search?: string;
    isActive?: string;
    hasTieUp?: string;
    state?: string;
    city?: string;
  }) {
    const where: any = {};

    if (query?.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { city: { contains: query.search, mode: 'insensitive' } },
        { state: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query?.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    if (query?.hasTieUp !== undefined) {
      where.hasTieUp = query.hasTieUp === 'true';
    }

    if (query?.state) {
      where.state = { contains: query.state, mode: 'insensitive' };
    }

    if (query?.city) {
      where.city = { contains: query.city, mode: 'insensitive' };
    }

    return this.prisma.college.findMany({
      where,
      include: {
        _count: {
          select: {
            courses: true,
            leadApplications: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const college = await this.prisma.college.findUnique({
      where: { id },
      include: {
        courses: true,
        approvedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            email: true,
          },
        },
        competitors: {
          include: {
            competitorCollege: true,
          },
        },
        _count: {
          select: {
            leadApplications: true,
          },
        },
      },
    });

    if (!college) {
      throw new NotFoundException('College not found');
    }

    return college;
  }

  async update(id: string, updateCollegeDto: UpdateCollegeDto) {
    const college = await this.prisma.college.findUnique({
      where: { id },
    });

    if (!college) {
      throw new NotFoundException('College not found');
    }

    if (updateCollegeDto.name && updateCollegeDto.name !== college.name) {
      const existing = await this.prisma.college.findUnique({
        where: { name: updateCollegeDto.name },
      });
      if (existing) {
        throw new ConflictException('College with this name already exists');
      }
    }

    return this.prisma.college.update({
      where: { id },
      data: updateCollegeDto,
    });
  }

  async approve(id: string, userId: string) {
    const college = await this.prisma.college.findUnique({
      where: { id },
    });

    if (!college) {
      throw new NotFoundException('College not found');
    }

    return this.prisma.college.update({
      where: { id },
      data: {
        isActive: true,
        approvedById: userId,
        approvedAt: new Date(),
      },
    });
  }

  async remove(id: string) {
    const college = await this.prisma.college.findUnique({
      where: { id },
    });

    if (!college) {
      throw new NotFoundException('College not found');
    }

    return this.prisma.college.update({
      where: { id },
      data: {
        isActive: false,
      },
    });
  }
}
