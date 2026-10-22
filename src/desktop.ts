import type { CommentAnchor, CommentPlacement, QuizRunSummary, ReviewDraft } from "./types";
import type { DiffMode } from "./components/review-ui";

export type Navigation = { path: string; filter: string; scroll: number; mode: DiffMode; anchor?: CommentAnchor };
export type DesktopData = {
  drafts: Record<string, ReviewDraft>;
  navigation: Record<string, Navigation>;
  selectedId?: string;
  placement: CommentPlacement;
  stackDepth: number;
  inboxVisible: boolean;
  chatVisible: boolean;
  expanded: Record<string, boolean>;
  quizSummaries?: QuizRunSummary[];
};
export type Checkpoint = { version: 1; revision: number; hasFeedback: boolean; data: DesktopData };
export type Bootstrap = { checkpoint: Checkpoint | null; review: string | null };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const anchor = (value: unknown): value is CommentAnchor => object(value) && typeof value.path === "string" &&
  (value.side === "old" || value.side === "new") && typeof value.line === "number" && Number.isInteger(value.line) && value.line > 0 &&
  (value.endLine === undefined || typeof value.endLine === "number" && Number.isInteger(value.endLine) && value.endLine >= value.line);
const comment = (value: unknown) => object(value) && typeof value.body === "string" && anchor(value);
const draft = (value: unknown) => object(value) && Array.isArray(value.comments) && value.comments.every(comment) &&
  typeof value.summary === "string" && (value.agentQuestion === undefined || typeof value.agentQuestion === "string") && object(value.pending) && Object.values(value.pending).every(item => comment(item) &&
    object(item) && (item.editingIndex === undefined || typeof item.editingIndex === "number" && Number.isInteger(item.editingIndex) && item.editingIndex >= 0)) &&
  object(value.threadStates) && Object.values(value.threadStates).every(state => ["open", "resolved", "dismissed"].includes(String(state)));

const quizSummary = (value: unknown) => object(value) && typeof value.id === "string" && typeof value.requestId === "string" && typeof value.head === "string" && typeof value.endedEarly === "boolean" &&
  [value.passed, value.failed, value.unassessed].every(count => typeof count === "number" && Number.isSafeInteger(count) && count >= 0);

export function validDesktopData(value: unknown): value is DesktopData {
  return object(value) && object(value.drafts) && Object.values(value.drafts).every(draft) &&
    object(value.navigation) && Object.values(value.navigation).every(item => object(item) &&
      typeof item.path === "string" && typeof item.filter === "string" && typeof item.scroll === "number" && Number.isFinite(item.scroll) && item.scroll >= 0 &&
      (item.mode === "unified" || item.mode === "split") && (item.anchor === undefined || anchor(item.anchor))) &&
    (value.selectedId === undefined || typeof value.selectedId === "string") &&
    ["auto", "inline", "beside"].includes(String(value.placement)) && typeof value.stackDepth === "number" && Number.isInteger(value.stackDepth) && value.stackDepth >= 1 && value.stackDepth <= 5 &&
    typeof value.inboxVisible === "boolean" && typeof value.chatVisible === "boolean" && object(value.expanded) &&
    Object.values(value.expanded).every(expanded => typeof expanded === "boolean") &&
    (value.quizSummaries === undefined || Array.isArray(value.quizSummaries) && value.quizSummaries.every(quizSummary));
}
