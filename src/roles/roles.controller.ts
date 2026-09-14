import { Controller, Post, Get, Body, Req, UseGuards } from '@nestjs/common';
import { CreateRoleDto } from './dto/roles.dto';
import { RolesService } from './roles.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(@Req() req: AuthenticatedRequest) {
    return this.rolesService.findAll(req.user?.roleId);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() createRoleDto: CreateRoleDto) {
    return this.rolesService.create(createRoleDto);
  }
}
