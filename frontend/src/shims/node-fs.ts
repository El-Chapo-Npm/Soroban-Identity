// The SDK's webhook dead-letter queue imports node:fs dynamically. The
// browser bundle never writes that queue; these stubs keep the import graph valid.

export async function mkdir(): Promise<void> {}
export async function writeFile(): Promise<void> {}
export async function readFile(): Promise<never> {
  throw new Error("node:fs/promises is not available in the browser");
}
export async function readdir(): Promise<string[]> {
  return [];
}
export async function rm(): Promise<void> {}
export async function access(): Promise<never> {
  throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
}
export async function mkdtemp(): Promise<never> {
  throw new Error("node:fs/promises is not available in the browser");
}
