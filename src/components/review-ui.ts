import { Text } from "@codemirror/state";
import { Chunk } from "@codemirror/merge";
import type { ReviewFile } from "../types";
export type DiffMode = "unified" | "split";
export function repositoryName(path: string) { return path.split(/[\\/]\.wt[\\/]/)[0].split(/[\\/]/).filter(Boolean).slice(-1)[0] || path; }
export function fileName(path: string) { return path.split("/").slice(-1)[0] || path; }
const statistics = new WeakMap<ReviewFile, { added: number; removed: number }>();
export function fileStats(file: ReviewFile) {
  const previous = statistics.get(file); if (previous) return previous;
  const a = Text.of(file.before.split("\n")), b = Text.of(file.after.split("\n"));
  const count = (doc: Text, from: number, to: number) => to <= from ? 0 : doc.lineAt(Math.max(from, Math.min(doc.length, to) - 1)).number - doc.lineAt(Math.min(from, doc.length)).number + 1;
  const value = Chunk.build(a,b).reduce((sum, chunk) => ({added:sum.added+count(b,chunk.fromB,chunk.toB),removed:sum.removed+count(a,chunk.fromA,chunk.toA)}),{added:0,removed:0});
  statistics.set(file,value); return value;
}
