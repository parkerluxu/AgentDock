import type { AgentEngine, AgentEnvironment, EnvironmentPermission, Id, Project, Run, Session } from "../core/types.js";

export interface Repository {
  engines: EntityRepository<AgentEngine>;
  environments: EntityRepository<AgentEnvironment>;
  projects: EntityRepository<Project>;
  environmentPermissions: EntityRepository<EnvironmentPermission>;
  sessions: EntityRepository<Session>;
  runs: EntityRepository<Run>;
}

export interface EntityRepository<T extends { id: Id }> {
  get(id: Id): T | undefined;
  list(): T[];
  upsert(entity: T): void;
  delete(id: Id): boolean;
}

class MemoryEntityRepository<T extends { id: Id }> implements EntityRepository<T> {
  private readonly entities = new Map<Id, T>();

  public get(id: Id): T | undefined {
    return this.entities.get(id);
  }

  public list(): T[] {
    return [...this.entities.values()];
  }

  public upsert(entity: T): void {
    this.entities.set(entity.id, entity);
  }

  public delete(id: Id): boolean {
    return this.entities.delete(id);
  }
}

export function createMemoryRepository(): Repository {
  return {
    engines: new MemoryEntityRepository<AgentEngine>(),
    environments: new MemoryEntityRepository<AgentEnvironment>(),
    projects: new MemoryEntityRepository<Project>(),
    environmentPermissions: new MemoryEntityRepository<EnvironmentPermission>(),
    sessions: new MemoryEntityRepository<Session>(),
    runs: new MemoryEntityRepository<Run>(),
  };
}
