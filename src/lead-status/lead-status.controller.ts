import { Body, Controller, Get, Post } from '@nestjs/common';
import { LeadStatusService } from './lead-status.service';
import { CreateLeadStatusDto } from './dto/create-lead-status.dto';

@Controller('lead-status')
export class LeadStatusController {
  constructor(private readonly leadStatusService: LeadStatusService) {}

  @Post()
  create(@Body() createLeadStatusDto: CreateLeadStatusDto) {
    return this.leadStatusService.create(createLeadStatusDto);
  }

  @Get()
  findAll() {
    return this.leadStatusService.findAll();
  }
}
