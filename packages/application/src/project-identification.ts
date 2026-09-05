import type {
  IdentifiedProject,
  ProjectIdentificationModelOutput,
} from "@holon/contracts";
export interface ProjectIdentificationModel {
  identify(
    project: IdentifiedProject,
    signal?: AbortSignal,
  ): Promise<ProjectIdentificationModelOutput>;
}
export type IdentificationCacheClaim =
  | { status: "hit"; project: IdentifiedProject }
  | { status: "claimed"; token: number }
  | { status: "pending"; retryAt: number }
  | { status: "unavailable" };
export interface ProjectIdentificationCache {
  claim(key: string, owner: string): Promise<IdentificationCacheClaim>;
  attempt(key: string, owner: string, token: number): Promise<boolean>;
  complete(
    key: string,
    owner: string,
    token: number,
    project: IdentifiedProject,
  ): Promise<boolean>;
  fail(key: string, owner: string, token: number): Promise<void>;
}
