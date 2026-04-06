export async function vsOpenFile(path: string, line?: number, column?: number): Promise<any> {
  // Implémentation exemple (à remplacer par le vrai bridge VS)
  return { ok: true, action: "vsOpenFile", path, line, column };
}

export async function vsBuildSolution(): Promise<any> {
  // Implémentation exemple
  return { ok: true, action: "vsBuildSolution" };
}

export async function vsPing(): Promise<any> {
  // Implémentation exemple
  return { ok: true, action: "vsPing" };
}
