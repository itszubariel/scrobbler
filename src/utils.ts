import { commandIds } from "./index.js";

export function cmdMention(name: string): string {
  const baseName = name.split(' ')[0] ?? name;
  const id = commandIds.get(baseName);
  return id ? `</${name}:${id}>` : `\`/${name}\``;
}

export function pageStr(page: number, totalPages: number): string {
  return totalPages > 1 ? `Page ${page + 1} of ${totalPages}` : `Page ${page + 1}`;
}
