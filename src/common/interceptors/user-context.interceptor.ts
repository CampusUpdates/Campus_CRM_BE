import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { UserContextService } from '../services/user-context.service';

@Injectable()
export class UserContextInterceptor implements NestInterceptor {
  constructor(private readonly userContextService: UserContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const userId = request?.user?.sub || request?.user?.id;

    return new Observable((observer) => {
      this.userContextService.run(userId, () => {
        next.handle().subscribe({
          next: (val) => observer.next(val),
          error: (err) => observer.error(err),
          complete: () => observer.complete(),
        });
      });
    });
  }
}
