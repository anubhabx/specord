import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type TempProjectOptions = {
  prefix: string;
  directories?: string[];
  include?: string[];
};

export function createTempProject(
  tempRoots: string[],
  options: TempProjectOptions,
): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), options.prefix));
  tempRoots.push(projectRoot);

  for (const directory of options.directories ?? ["src"]) {
    fs.mkdirSync(path.join(projectRoot, directory), { recursive: true });
  }

  fs.writeFileSync(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          experimentalDecorators: true,
          module: "Node16",
          moduleResolution: "Node16",
          noEmit: true,
          strict: true,
          target: "ES2022",
        },
        include: options.include ?? ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );

  return projectRoot;
}

export function cleanupTempProjects(tempRoots: string[]): void {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
