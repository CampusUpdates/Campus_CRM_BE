import { Body, Controller, Get, Post } from '@nestjs/common';
import { OfficeService } from './office.service';
import { CreateOfficeDto } from './dto/create-office.dto';

@Controller('offices')
export class OfficeController {
  constructor(private readonly officeService: OfficeService) {}

  @Post()
  create(@Body() createOfficeDto: CreateOfficeDto) {
    return this.officeService.create(createOfficeDto);
  }

  @Get()
  findAll() {
    return this.officeService.findAll();
  }
}