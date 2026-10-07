// The shape of `window.desktopBridge`, shared by the preload (which builds it)
// and the web app (which calls it). Types only: nothing here runs on either side.
export interface DesktopBridge {
  versions: { electron: string; chrome: string; node: string };
  ping(): Promise<PingResult>;
}

export type PingResult =
  | { ok: true; version: string; database: string; pid: number }
  | { ok: false; message: string };
