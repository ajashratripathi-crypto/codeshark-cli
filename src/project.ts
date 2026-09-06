import { statSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, dirname, relative, resolve, sep } from "node:path";

export class ProjectFolderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectFolderError";
  }
}

/** Confirm that the selected working directory is a real folder. */
export function requireProjectFolder(folder = process.cwd()): string {
  const resolved = resolve(folder);
  const stat = statSync(resolved, { throwIfNoEntry: false });
  if (!stat) {
    throw new ProjectFolderError(`Project folder does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new ProjectFolderError(`CodeShark needs a folder, not a file: ${resolved}`);
  }
  return resolved;
}

/** Resolve a path while keeping the agent inside its selected project folder. */
export function resolveProjectPath(input: string, cwd: string): string {
  const root = resolve(cwd);
  const target = isAbsolute(input) ? resolve(input) : resolve(root, input);
  const inside = (base: string, candidate: string): boolean => {
    const path = relative(base, candidate);
    return path === "" || (path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path));
  };
  if (!inside(root, target)) throw new ProjectFolderError("Path escapes the project folder: " + input);
  // Validate existing ancestors so links cannot redirect new writes outside the project.
  let ancestor = target;
  while (!lstatSync(ancestor, { throwIfNoEntry: false })) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new ProjectFolderError("Cannot resolve project path: " + input);
    ancestor = parent;
  }
  if (!inside(realpathSync(root), realpathSync(ancestor))) {
    throw new ProjectFolderError("Path escapes the project folder through a link: " + input);
  }
  return target;
}

/** Change into an explicitly selected project folder before starting CodeShark. */
export function openProjectFolder(folder: string): string {
  const resolved = requireProjectFolder(folder);
  process.chdir(resolved);
  return resolved;
}

/** Parse --folder / --cwd without treating normal prompt text as a path. */
export function extractFolderArg(args: string[]): { args: string[]; folder?: string } {
  const remaining: string[] = [];
  let folder: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--folder" || arg === "--cwd") {
      const next = args[++i];
      // No path given: default to the current folder instead of failing,
      // so `codeshark --folder` just works from inside the project.
      folder = next ? (isAbsolute(next) ? next : resolve(process.cwd(), next)) : process.cwd();
    } else if (arg.startsWith("--folder=") || arg.startsWith("--cwd=")) {
      folder = arg.slice(arg.indexOf("=") + 1);
    } else {
      remaining.push(arg);
    }
  }
  return { args: remaining, folder };
}
