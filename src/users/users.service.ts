import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateUserDto } from './dto/crete-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
    constructor(private readonly prisma: PrismaService) { }
    async findAll() {
        const result = this.prisma.user.findMany();
        return result;
    }

    //create user
    async create(createUserDto: CreateUserDto) {
        const hashedPassword = await bcrypt.hash(createUserDto.password, 10)
        return this.prisma.user.create({
            data: {
                firstName: createUserDto.firstName,
                lastName: createUserDto.lastName,
                email: createUserDto.email,
                phone: createUserDto.phone,
                passwordHash: hashedPassword,
                roleId: createUserDto.roleId,
                teamId: createUserDto.teamId,
            },
        });
    }
}
