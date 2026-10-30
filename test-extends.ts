import { PrismaClient } from '@prisma/client';

class MyPrisma extends PrismaClient {
  constructor() {
    super();
    const extended = this.$extends({});
    return extended as unknown as MyPrisma;
  }
  
  onModuleInit() {
    console.log("onModuleInit called");
  }
}

const p = new MyPrisma();
if (p.onModuleInit) {
  p.onModuleInit();
} else {
  console.log("onModuleInit is missing!");
}
