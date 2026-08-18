import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  Param,
  Patch,
  Get,
  Query,
} from '@nestjs/common';

import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(
    @Body() createLeadDto: CreateLeadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.create(createLeadDto, req.user.sub);
  }
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateLeadDto: UpdateLeadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadsService.update(id, updateLeadDto, req.user.sub);
  }
  //get lead by id
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.leadsService.findOne(id, req.user.sub);
  }
  @UseGuards(JwtAuthGuard)
  @Get('search')
  searchByPhone(@Query('phone') phone: string) {
    return this.leadsService.searchByPhone(phone);
  }
}
