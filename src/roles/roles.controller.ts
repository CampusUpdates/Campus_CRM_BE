import { Controller, Post, Get, Body } from '@nestjs/common';
import { CreateRoleDto } from './dto/roles.dto';
import { RolesService } from './roles.service';
@Controller('roles')
export class RolesController {
    constructor(private readonly rolesService: RolesService){}
    
    @Get()
    findAll(){
      return this.rolesService.findAll()
    }

    @Post()
    create(@Body() createRoleDto: CreateRoleDto){
        return this.rolesService.create(createRoleDto)
    }
}
