import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

interface UserStore {
  userId?: string;
}

@Injectable()
export class UserContextService {
  private static readonly asyncLocalStorage =
    new AsyncLocalStorage<UserStore>();

  run<T>(userId: string | undefined, callback: () => T): T {
    return UserContextService.asyncLocalStorage.run({ userId }, callback);
  }

  getUserId(): string | undefined {
    const store = UserContextService.asyncLocalStorage.getStore();
    return store?.userId;
  }
}
