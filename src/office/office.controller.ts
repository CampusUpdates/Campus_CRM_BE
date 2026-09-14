import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OfficeService } from './office.service';
import { CreateOfficeDto } from './dto/create-office.dto';
import {
  UpdateOfficeDto,
  UpdateOfficeStatusDto,
} from './dto/update-office.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from 'src/auth/guards/permissions/permissions.guard';
import { RequirePermission } from 'src/permissions/permissions.decorator';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

@Controller('office')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OfficeController {
  constructor(private readonly officeService: OfficeService) {}

  @RequirePermission('OFFICE_MANAGE')
  @Get()
  findAll() {
    return this.officeService.findAll();
  }

  @RequirePermission('OFFICE_MANAGE')
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.officeService.findOne(id);
  }

  @RequirePermission('OFFICE_MANAGE')
  @Post()
  create(
    @Body() createOfficeDto: CreateOfficeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.officeService.create(createOfficeDto, req.user?.sub);
  }

  @RequirePermission('OFFICE_MANAGE')
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOfficeDto: UpdateOfficeDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.officeService.update(id, updateOfficeDto, req.user?.sub);
  }

  @RequirePermission('OFFICE_MANAGE')
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() statusDto: UpdateOfficeStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.officeService.updateStatus(
      id,
      statusDto.isActive,
      req.user?.sub,
    );
  }
}
