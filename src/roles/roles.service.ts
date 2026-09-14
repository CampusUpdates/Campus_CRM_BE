import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateRoleDto } from './dto/roles.dto';
import { ConflictException } from '@nestjs/common';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  //find all roles (optionally filtered by user permissions)
  async findAll(userRoleId?: number) {
    const superAdminRole = await this.prisma.role.findUnique({
      where: { name: 'SUPER_ADMIN' },
    });

    const isSuperAdminCaller =
      userRoleId && superAdminRole && userRoleId === superAdminRole.id;

    const result = await this.prisma.role.findMany({
      where: isSuperAdminCaller
        ? {}
        : {
            name: {
              not: 'SUPER_ADMIN',
            },
          },
      orderBy: {
        displayOrder: 'asc',
      },
    });
    return result;
  }
  //create new role
  async create(createRoleDto: CreateRoleDto) {
    //check if role already exists
    const existingRole = await this.prisma.role.findUnique({
      where: {
        name: createRoleDto.name,
      },
    });

    if (existingRole) {
      throw new ConflictException('Role already exists.');
    }
    const lastRole = await this.prisma.role.findFirst({
      orderBy: {
        displayOrder: 'desc',
      },
    });
    const nextDisplayOrder = lastRole ? lastRole.displayOrder + 1 : 1;
    const role = await this.prisma.role.create({
      data: {
        name: createRoleDto.name,
        description: createRoleDto.description,
        displayOrder: nextDisplayOrder,
      },
    });

    return role;
  }
}
