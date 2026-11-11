import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { RuleError } from '../rules/index.js';

/** Transforme une violation du règlement en réponse 422 { code, message }. */
@Catch(RuleError)
export class RuleErrorFilter implements ExceptionFilter {
  catch(error: RuleError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<{ status(code: number): { json(body: unknown): void } }>();
    res.status(422).json({ code: error.code, message: error.message });
  }
}
