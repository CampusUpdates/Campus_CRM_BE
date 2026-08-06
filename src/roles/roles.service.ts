import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateRoleDto } from './dto/roles.dto';
import { ConflictException } from '@nestjs/common';

@Injectable()
export class RolesService {
    constructor(private readonly prisma: PrismaService) { }

    //find all roles 
    async findAll() {
        const result = await this.prisma.role.findMany(
            {
                orderBy: {
                    displayOrder: 'asc'
                }
            },)
        return result
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

        const role = await this.prisma.role.create({
            data: {
                name: createRoleDto.name,
                description: createRoleDto.description,
                displayOrder: createRoleDto.displayOrder,
            },
        });

        return role;
    }
}
