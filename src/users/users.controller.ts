import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserTeamDto } from './dto/update-user-team.dto';
import { PermissionsGuard } from 'src/auth/guards/permissions/permissions.guard';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RequirePermission } from 'src/permissions/permissions.decorator';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

import { ReplaceSuperAdminDto } from './dto/replace-super-admin.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Get logged-in user profile
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.usersService.getProfile(req.user.sub);
  }

  // Update logged-in user profile
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(req.user.sub, updateProfileDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('USER_MANAGE')
  @Post('replace-super-admin')
  replaceSuperAdmin(
    @Body() replaceDto: ReplaceSuperAdminDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.replaceSuperAdmin(replaceDto, req.user.sub);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('USER_MANAGE')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('USER_MANAGE')
  @Post()
  create(
    @Body() createUserDto: CreateUserDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.create(createUserDto, req.user);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('USER_MANAGE')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.update(id, updateUserDto, req.user.sub);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('USER_MANAGE')
  @Patch(':id/team')
  updateTeam(
    @Param('id') id: string,
    @Body() updateUserTeamDto: UpdateUserTeamDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.updateTeam(
      id,
      updateUserTeamDto.teamId ?? null,
      req.user.sub,
    );
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('USER_MANAGE')
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() updateUserStatusDto: UpdateUserStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.updateStatus(
      id,
      updateUserStatusDto.status,
      req.user.sub,
    );
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('USER_MANAGE')
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.usersService.deactivate(id, req.user.sub);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('USER_MANAGE')
  @Patch(':id/activate')
  activate(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.usersService.activate(id, req.user.sub);
  }
}
