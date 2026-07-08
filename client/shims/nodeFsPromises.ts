export async function mkdir(): Promise<never> {
  throw new Error("node:fs/promises is not available in the browser");
}

export async function readdir(): Promise<never> {
  throw new Error("node:fs/promises is not available in the browser");
}

export async function readFile(): Promise<never> {
  throw new Error("node:fs/promises is not available in the browser");
}

export async function writeFile(): Promise<never> {
  throw new Error("node:fs/promises is not available in the browser");
}

export default {
  mkdir,
  readdir,
  readFile,
  writeFile,
};
