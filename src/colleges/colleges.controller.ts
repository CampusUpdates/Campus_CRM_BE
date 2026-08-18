import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CollegesService } from './colleges.service';
import { CreateCollegeDto } from './dto/create-college.dto';
import { UpdateCollegeDto } from './dto/update-college.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

@Controller('colleges')
export class CollegesController {
  constructor(private readonly collegesService: CollegesService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() createCollegeDto: CreateCollegeDto) {
    return this.collegesService.create(createCollegeDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('hasTieUp') hasTieUp?: string,
    @Query('state') state?: string,
    @Query('city') city?: string,
  ) {
    return this.collegesService.findAll({ search, isActive, hasTieUp, state, city });
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.collegesService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateCollegeDto: UpdateCollegeDto,
  ) {
    return this.collegesService.update(id, updateCollegeDto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/approve')
  approve(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.collegesService.approve(id, req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.collegesService.remove(id);
  }
}
