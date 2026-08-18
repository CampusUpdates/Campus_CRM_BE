import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateOfficeDto } from './dto/create-office.dto';

@Injectable()
export class OfficeService {
  constructor(private readonly prisma: PrismaService) {}

  //find all the office location
  async findAll() {
    const offices = await this.prisma.office.findMany({
      orderBy: {
        name: 'asc',
      },
    });

    return offices;
  }
  //create an office with location
  async create(createOfficeDto: CreateOfficeDto) {
    const existingOffice = await this.prisma.office.findUnique({
      where: {
        name: createOfficeDto.name,
      },
    });

    if (existingOffice) {
      throw new ConflictException('Office already exists.');
    }

    const office = await this.prisma.office.create({
      data: {
        name: createOfficeDto.name,
        address: createOfficeDto.address,
        city: createOfficeDto.city,
        state: createOfficeDto.state,
      },
    });

    return office;
  }
}
