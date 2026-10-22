export type Source = {
	repo: string;
	base: string;
	head: string;
	baseRef: string;
	headRef: string;
};
export type ReviewFile = {
	path: string;
	status: string;
	before: string;
	after: string;
	unavailable: string | null;
};
export type ReviewRequest = {
	version: number;
	id: string;
	title: string;
	source: Source;
	files: ReviewFile[];
};
export type ReviewSummary = {
	id: string;
	title: string;
	source: Source;
	fileCount: number;
	complete: boolean;
};
export type ReviewContext = { guide: string; comments: Comment[]; owner?: "caller" | "app"; reviewerEnabled?: boolean };
export type ReviewResult = {
	version: number; requestId: string; status: "complete";
	feedback: { head: string; comments: Comment[]; summary: string | null; threadStates?: ThreadUpdate[] };
};
export type CommentPlacement = "auto" | "inline" | "beside";
export type PendingComment = CommentAnchor & { body: string; editingIndex?:number };
export type ReviewDraft = { comments: Comment[]; summary: string; pending: Record<string, PendingComment>; threadStates: Record<string, ThreadStatus> };
export type CommentAnchor = { path: string; line: number; endLine?: number; side: "old" | "new" };
export type ThreadStatus = "open" | "resolved" | "dismissed";
export type ThreadUpdate = CommentAnchor & { state: ThreadStatus };
export type Comment = {
	path: string;
	side: "old" | "new";
	line: number;
	endLine?: number;
	body: string;
};
export type QuizRunSummary = { id:string;requestId:string;head:string;passed:number;failed:number;unassessed:number;endedEarly:boolean };
