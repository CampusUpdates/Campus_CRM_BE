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
import { TodosService } from './todos.service';
import { CreateTodoDto } from './dto/create-todo.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from 'src/auth/interfaces/authenticated-request.interface';

@Controller('todos')
export class TodosController {
  constructor(private readonly todosService: TodosService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  getTodos(@Req() req: AuthenticatedRequest, @Query('date') date?: string) {
    return this.todosService.getTodos(req.user.sub, date);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  createTodo(@Body() dto: CreateTodoDto, @Req() req: AuthenticatedRequest) {
    return this.todosService.createTodo(dto, req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  updateTodo(
    @Param('id') id: string,
    @Body() dto: UpdateTodoDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.todosService.updateTodo(id, dto, req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  deleteTodo(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.todosService.deleteTodo(id, req.user.sub);
  }
}
