import { createMemo, For, Show } from "solid-js";
import type { ReviewRequest } from "./types";

export type AgentState = {
	requestId: string;
	phase: "starting" | "reviewing" | "complete" | "error";
	sequence: number;
	text: string;
	error: string | null;
	files: string[];
	omitted: number;
	sessionPath: string;
};
export type Finding = {
	path: string;
	side: "old" | "new";
	line: number;
	endLine?: number;
	severity: string;
	title: string;
	body: string;
};

export function parseReport(text: string, request: ReviewRequest) {
	try {
		const json = JSON.parse(
			text
				.trim()
				.replace(/^```(?:json)?\s*/, "")
				.replace(/```$/, ""),
		);
		if (typeof json.summary !== "string" || !Array.isArray(json.findings))
			return undefined;
		const findings: Finding[] = [];
		let invalid = 0;
		for (const item of json.findings) {
			const file = request.files.find((file) => file.path === item?.path);
			const content = file
				? item.side === "old"
					? file.before
					: file.after
				: "";
			const lines = Math.max(
				1,
				content.split("\n").length - (content.endsWith("\n") ? 1 : 0),
			);
			if (
				!file ||
				file.unavailable ||
				!["old", "new"].includes(item.side) ||
				!Number.isInteger(item.line) ||
				item.line < 1 ||
				item.line > lines ||
				(item.endLine !== undefined && (!Number.isInteger(item.endLine) || item.endLine < item.line || item.endLine > lines)) ||
				typeof item.title !== "string" ||
				typeof item.body !== "string" ||
				!["P1", "P2", "P3"].includes(item.severity)
			) {
				invalid++;
				continue;
			}
			findings.push(item);
		}
		return { summary: json.summary, findings: findings.slice(0, 5), invalid };
	} catch {
		return undefined;
	}
}

export default function AgentReport(props: {
	state: AgentState;
	request: ReviewRequest;
	onJump: (path: string, line?: number, side?: "old" | "new") => void;
	dismissed?: ReadonlySet<number>;
	onRestore?: (index: number) => void;
}) {
	const report = createMemo(() => parseReport(props.state.text, props.request));
	return (
		<section class="agent-report">
			<div class="agent-heading comment-byline">
				<span class="comment-avatar">π</span><strong>Pi</strong><span class="agent-purpose">Review recommendation</span>
				<span class={`agent-phase ${props.state.phase}`}>
					{props.state.phase === "complete" ? "Ready" : props.state.phase === "error" ? "Needs attention" : "Reviewing"}
				</span>
			</div>
			<p class="muted agent-safety">
				Native Pi via Ferropi · No tools or test execution
			</p>
			<details class="agent-scope">
				<summary>
					Agent activity · {props.state.files.length} files · {props.state.omitted} omitted
				</summary>
				<For each={props.state.files}>{(path) => <div>{path}</div>}</For>
			</details>
			<Show when={props.state.error}>
				<p class="error" role="alert">
					{props.state.error}
				</p>
			</Show>
			<Show
				when={report()}
				fallback={
					<Show when={props.state.text}>
						<details>
							<summary>Streaming report</summary>
							<pre>{props.state.text}</pre>
						</details>
					</Show>
				}
			>
				{(report) => (
					<>
						<p class="agent-recommendation">{report().summary}</p>
						<For each={report().findings}>
							{(finding,index) => (
								<button
									class="finding-card"
									classList={{"dismissed-finding":props.dismissed?.has(index())}}
									onClick={() =>
										props.onJump(
											finding.path,
											finding.line, finding.side,
										)
									}
								>
									<span class="finding-title">
										<span class="severity">{finding.severity}</span>
										<span class="finding-short-title" title={finding.title}>{finding.title}</span>
									</span>
									<span class="comment-anchor">
										{finding.path}:{finding.line} · {finding.side}
									</span>
									<span class="finding-preview" title={finding.body}>{finding.body}</span><Show when={props.dismissed?.has(index())}><span class="finding-dismissed-label">Dismissed · click to locate</span></Show>
								</button>
							)}
						</For>
						<Show
							when={
								props.state.phase === "complete" &&
								!report().findings.length &&
								!report().invalid
							}
						>
							<p class="muted">No material findings reported.</p>
						</Show>
						<Show when={report().invalid}>
							<p class="error">
								{report().invalid} invalid finding anchors were rejected.
							</p>
						</Show>
					</>
				)}
			</Show>
		</section>
	);
}
