/**
 * The exact HTTP requests behind every mutating Liara operation.
 *
 * One source for two consumers: `RealLiaraClient` sends these, and DRY_RUN /
 * approval cards display them. Because both read the same builder, what the
 * user approves is what gets sent. Paths come from docs/liara-api/NOTES.md.
 */
import type { CreateAppInput, CreateDatabaseInput, DeployInput, PlannedCall } from "./types";

const enc = encodeURIComponent;

/** Placeholder shown wherever a secret value would go. */
export const SECRET_PLACEHOLDER = "«secret»";

export const LiaraRequests = {
  createApp(input: CreateAppInput): PlannedCall {
    return {
      method: "POST",
      path: "/v1/projects",
      body: { name: input.name, planID: input.planId, platform: input.platform },
    };
  },

  deleteApp(name: string): PlannedCall {
    return { method: "DELETE", path: `/v1/projects/${enc(name)}` };
  },

  scale(name: string, scale: 0 | 1): PlannedCall {
    return { method: "POST", path: `/v1/projects/${enc(name)}/actions/scale`, body: { scale } };
  },

  restart(name: string): PlannedCall {
    return { method: "POST", path: `/v1/projects/${enc(name)}/actions/restart` };
  },

  resize(name: string, planId: string): PlannedCall {
    return { method: "POST", path: `/v1/projects/${enc(name)}/resize`, body: { planID: planId } };
  },

  /** Values are never part of a planned call; only keys are shown. */
  updateEnvs(name: string, keys: string[]): PlannedCall {
    return {
      method: "POST",
      path: "/v1/projects/update-envs",
      body: { project: name, variables: keys.map((key) => ({ key, value: SECRET_PLACEHOLDER })) },
    };
  },

  deploy(input: DeployInput): PlannedCall[] {
    return [
      {
        method: "POST",
        path: `/v2/projects/${enc(input.app)}/sources`,
        body: { file: "<source.tar.gz>" },
        note: "multipart upload of the source archive",
      },
      {
        method: "POST",
        path: `/v2/projects/${enc(input.app)}/releases`,
        body: { sourceID: "<from previous call>", port: input.port, type: input.platform },
      },
    ];
  },

  createDatabase(input: CreateDatabaseInput): PlannedCall {
    return {
      method: "POST",
      path: "/v1/databases",
      body: { hostname: input.name, type: input.type, planID: input.planId },
    };
  },

  createDisk(app: string, name: string, sizeGb: number): PlannedCall {
    return { method: "POST", path: `/v1/projects/${enc(app)}/disks`, body: { name, size: sizeGb } };
  },
} as const;

export function formatCall(call: PlannedCall): string {
  const body = call.body === undefined ? "" : ` ${JSON.stringify(call.body)}`;
  return `${call.method} ${call.path}${body}`;
}
