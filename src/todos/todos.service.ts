import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTodoDto } from './dto/create-todo.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';

@Injectable()
export class TodosService {
  constructor(private readonly prisma: PrismaService) {}

  async getTodos(userId: string, dateStr?: string) {
    const whereClause: any = { userId };

    if (dateStr) {
      // Date filter (e.g. 2026-08-25)
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        whereClause.dueDate = date;
      }
    }

    return this.prisma.todo.findMany({
      where: whereClause,
      orderBy: [
        { isCompleted: 'asc' },
        { dueDate: 'asc' },
        { createdAt: 'desc' },
      ],
    });
  }

  async createTodo(dto: CreateTodoDto, userId: string) {
    const dueDate = new Date(dto.dueDate);

    return this.prisma.todo.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        dueDate,
        priority: dto.priority || 'MEDIUM',
        isCompleted: dto.isCompleted || false,
      },
    });
  }

  async updateTodo(id: string, dto: UpdateTodoDto, userId: string) {
    const todo = await this.prisma.todo.findUnique({
      where: { id },
    });

    if (!todo) {
      throw new NotFoundException('Todo not found');
    }

    if (todo.userId !== userId) {
      throw new ForbiddenException('You can only update your own todos');
    }

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.dueDate !== undefined) data.dueDate = new Date(dto.dueDate);
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.isCompleted !== undefined) data.isCompleted = dto.isCompleted;

    return this.prisma.todo.update({
      where: { id },
      data,
    });
  }

  async deleteTodo(id: string, userId: string) {
    const todo = await this.prisma.todo.findUnique({
      where: { id },
    });

    if (!todo) {
      throw new NotFoundException('Todo not found');
    }

    if (todo.userId !== userId) {
      throw new ForbiddenException('You can only delete your own todos');
    }

    await this.prisma.todo.delete({
      where: { id },
    });

    return { message: 'Todo deleted successfully' };
  }
}
