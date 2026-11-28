/** Types de l'API du Core (voir core/README.md). */
export type Os = 'linux' | 'macos' | 'windows';

export interface Telemetry {
  cpu: number;
  ram: number;
  disk: number;
  ramUsedGb?: number;
  ramTotalGb?: number;
  diskFreeGb?: number;
  battery: { percent: number; charging: boolean } | null;
  /** Session verrouillée (null si le système ne le dit pas). */
  locked?: boolean | null;
  /** Veille légère ORION : écran éteint, PC joignable. */
  standby?: boolean;
  uptimeS: number;
  hostname?: string;
  agentVersion?: string;
}

export interface Device {
  id: string;
  name: string;
  os: Os;
  osVersion: string;
  hostname: string;
  online: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  telemetry: { at: string; data: Telemetry } | null;
}

export type CommandStatus = 'pending' | 'sent' | 'running' | 'done' | 'failed' | 'timeout';

export type Action =
  | 'capabilities'
  | 'unlock'
  | 'standby'
  | 'apps.list'
  | 'apps.open'
  | 'web'
  | 'keys'
  | 'type'
  | 'remote'
  | 'status'
  | 'screenshot'
  | 'lock'
  | 'sleep'
  | 'notify'
  | 'files.list'
  | 'files.search'
  | 'files.get'
  | 'files.zip'
  | 'files.open'
  | 'files.receive'
  | 'clipboard.get'
  | 'clipboard.set'
  | 'open.url'
  | 'volume'
  | 'media'
  | 'power';

export interface Command {
  id: string;
  deviceId: string;
  action: Action;
  params: Record<string, unknown>;
  status: CommandStatus;
  result: Record<string, any> | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  device?: { name: string; os: Os };
}

export interface FileItem {
  name: string;
  path: string;
  kind: 'folder' | 'file';
  size: number | null;
  modified: string;
  hidden?: boolean;
}

export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export const FINAL_STATUSES: CommandStatus[] = ['done', 'failed', 'timeout'];
