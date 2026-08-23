import type { Id, Project, Profile, Policy, Run, RuntimeDescriptor, Session } from "../core/types.js";

export interface Repository {
  runtimes: EntityRepository<RuntimeDescriptor>;
  profiles: EntityRepository<Profile>;
  projects: EntityRepository<Project>;
  policies: EntityRepository<Policy>;
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
    runtimes: new MemoryEntityRepository<RuntimeDescriptor>(),
    profiles: new MemoryEntityRepository<Profile>(),
    projects: new MemoryEntityRepository<Project>(),
    policies: new MemoryEntityRepository<Policy>(),
    sessions: new MemoryEntityRepository<Session>(),
    runs: new MemoryEntityRepository<Run>(),
  };
}
