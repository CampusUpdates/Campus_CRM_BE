import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePositionDto } from './dto/create-positions.dto';

@Injectable()
export class PositionsService {
    constructor(private readonly prisma: PrismaService) {}
    //find positions
    async findAll() {
  const positions = await this.prisma.position.findMany({
    orderBy: {
      title: 'asc',
    },
  });

  return positions;
}
//create positions
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
  },
});

return position;
}
}
