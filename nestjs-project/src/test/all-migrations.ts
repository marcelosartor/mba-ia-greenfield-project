import type { DataSource, MigrationInterface } from 'typeorm';
import { CreateUsersAndChannels1775687773260 } from '../database/migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from '../database/migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1789938672313 } from '../database/migrations/1789938672313-CreateVideos';
import { AddDeclaredSizeToVideos1790433669266 } from '../database/migrations/1790433669266-AddDeclaredSizeToVideos';
import { CreateCategories1790521611777 } from '../database/migrations/1790521611777-CreateCategories';
import { SeedCategories1790521625754 } from '../database/migrations/1790521625754-SeedCategories';
import { AddVideoManagementColumns1790521828575 } from '../database/migrations/1790521828575-AddVideoManagementColumns';

/**
 * Every migration, in execution order. Test data sources import the classes
 * directly (ts-jest does not resolve TypeORM globs); a migration test that
 * undoes some of them must re-run this full list in `afterAll`, so the shared
 * database is fully migrated for the suites that follow.
 */
export const ALL_MIGRATIONS: (new () => MigrationInterface)[] = [
  CreateUsersAndChannels1775687773260,
  CreateAuthTokens1777579850478,
  CreateVideos1789938672313,
  AddDeclaredSizeToVideos1790433669266,
  CreateCategories1790521611777,
  SeedCategories1790521625754,
  AddVideoManagementColumns1790521828575,
];

/**
 * Undoes the executed migrations, newest first, until `target` itself has been
 * undone (so the schema is left as it was right before `target`).
 */
export async function undoMigrationsThrough(
  dataSource: DataSource,
  target: new () => MigrationInterface,
): Promise<void> {
  const targetName = new target().name ?? target.name;
  for (;;) {
    const [last] = await dataSource.query<{ name: string }[]>(
      'SELECT "name" FROM "migrations" ORDER BY "id" DESC LIMIT 1',
    );
    if (!last) throw new Error(`Migration ${targetName} was not executed`);
    await dataSource.undoLastMigration();
    if (last.name === targetName) return;
  }
}
