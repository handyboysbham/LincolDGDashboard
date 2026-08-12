import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDatabase, createDatabasePool, type Database, type Pool } from "@ldg/database";

import { ServerConfigService } from "../config/server-config.service.js";
import { DATABASE, DATABASE_POOL } from "./database.tokens.js";

@Injectable()
class DatabaseShutdown implements OnApplicationShutdown {
  public constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  public async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  exports: [DATABASE, DATABASE_POOL],
  providers: [
    {
      inject: [ServerConfigService],
      provide: DATABASE_POOL,
      useFactory: (configuration: ServerConfigService): Pool =>
        createDatabasePool(configuration.value.databaseUrl, {
          max: configuration.value.databasePoolMax,
        }),
    },
    {
      inject: [DATABASE_POOL],
      provide: DATABASE,
      useFactory: (pool: Pool): Database => createDatabase(pool),
    },
    DatabaseShutdown,
  ],
})
export class DatabaseModule {}
