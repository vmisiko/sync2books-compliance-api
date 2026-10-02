import { QueryRunner, SimpleConsoleLogger } from 'typeorm';

/**
 * TypeORM's console logger, minus the query parameters.
 *
 * With `logging: true` TypeORM writes every statement followed by
 * `-- PARAMETERS: [...]`, and the parameters are exactly the sensitive part: an
 * API-key lookup is `WHERE apiKey = ?` with the key as the parameter, a login
 * binds the email, an OAuth write binds tokens. The statement alone is what
 * debugging needs, so that is all that is logged -- for ordinary queries, slow
 * ones and failed ones alike.
 */
export class ParameterRedactingTypeOrmLogger extends SimpleConsoleLogger {
  logQuery(query: string, _parameters?: unknown[], queryRunner?: QueryRunner) {
    super.logQuery(query, undefined, queryRunner);
  }

  logQueryError(
    error: string,
    query: string,
    _parameters?: unknown[],
    queryRunner?: QueryRunner,
  ) {
    super.logQueryError(error, query, undefined, queryRunner);
  }

  logQuerySlow(
    time: number,
    query: string,
    _parameters?: unknown[],
    queryRunner?: QueryRunner,
  ) {
    super.logQuerySlow(time, query, undefined, queryRunner);
  }
}
