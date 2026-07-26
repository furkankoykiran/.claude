/** Minimal, dependency-free logging. Plain stderr so stdout stays script-friendly. */

export function info(msg: string): void {
  process.stderr.write(`==> ${msg}\n`);
}
export function warn(msg: string): void {
  process.stderr.write(`!! ${msg}\n`);
}
export function error(msg: string): void {
  process.stderr.write(`xx ${msg}\n`);
}
export function dim(msg: string): void {
  process.stderr.write(`   ${msg}\n`);
}