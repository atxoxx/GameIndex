/** Geometry helpers mirroring `@tauri-apps/api/dpi`. */

export class LogicalSize {
  readonly type = "Logical";
  constructor(
    public width: number,
    public height: number,
  ) {}
}

export class PhysicalSize {
  readonly type = "Physical";
  constructor(
    public width: number,
    public height: number,
  ) {}
}

export class LogicalPosition {
  readonly type = "Logical";
  constructor(
    public x: number,
    public y: number,
  ) {}
}

export class PhysicalPosition {
  readonly type = "Physical";
  constructor(
    public x: number,
    public y: number,
  ) {}
}

export type Size = LogicalSize | PhysicalSize;
export type Position = LogicalPosition | PhysicalPosition;
