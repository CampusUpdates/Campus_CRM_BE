import { Body, Controller, Get, Post, Patch, Param, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PermissionsGuard } from 'src/auth/guards/permissions/permissions.guard';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { Permissions } from 'src/permissions/permissions.decorator';
@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Get()
    findAll() {
        return this.usersService.findAll();
    }
    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.usersService.findOne(id);
    }
    @Post()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('USER_CREATE')
    create(@Body() createUserDto: CreateUserDto) {
        return this.usersService.create(createUserDto)
    }

    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('USER_UPDATE')
    @Patch(':id')
    update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
        return this.usersService.update(id, updateUserDto)
    }

    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @Permissions('USER_DEACTIVATE')
    @Patch(':id/deactivate')
    deactivate(@Param('id') id: string) {
        return this.usersService.deactivate(id)
    }
    @Patch(':id/activate')
    activate(@Param('id') id: string) {
        return this.usersService.activate(id)
    }
}
