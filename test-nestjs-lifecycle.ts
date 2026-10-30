import 'reflect-metadata';
import { Injectable, Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';

@Injectable()
class MyPrisma extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    const extended = this.$extends({});
    return extended as unknown as MyPrisma;
  }
  
  async onModuleInit() {
    console.log("NestJS called onModuleInit");
  }
  
  async onModuleDestroy() {
    console.log("NestJS called onModuleDestroy");
  }
}

@Module({
  providers: [MyPrisma]
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  await app.close();
}
bootstrap();
