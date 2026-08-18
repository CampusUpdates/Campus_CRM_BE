import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTeamDto } from './dto/create-team.dto';

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  //find all teams

  async findAll() {
    const teams = await this.prisma.team.findMany({
      orderBy: {
        name: 'asc',
      },
    });

    return teams;
  }

  //create team

  async create(createTeamDto: CreateTeamDto) {
    const existingTeam = await this.prisma.team.findUnique({
      where: {
        name: createTeamDto.name,
      },
    });

    if (existingTeam) {
      throw new ConflictException('Team already exists.');
    }

    const team = await this.prisma.team.create({
      data: {
        name: createTeamDto.name,
        description: createTeamDto.description,
      },
    });

    return team;
  }
}
