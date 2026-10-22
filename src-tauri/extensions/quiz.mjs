import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";

export default function (pi) {
  let pending = false;
  let answeredQuestion = null;
  pi.registerTool(defineTool({
    name: "present_question",
    label: "Ask reviewer",
    exposure: "model-only",
    description: "Ask one question about the supplied immutable change. Wait for the human answer, explain it, then ask another question or finish. Never call in parallel.",
    parameters: Type.Object({
      question: Type.String({ minLength: 1, maxLength: 8000 }),
      choices: Type.Array(Type.String({ minLength: 1, maxLength: 1000 }), { minItems: 2, maxItems: 6 }),
      anchors: Type.Optional(Type.Array(Type.Object({
        path: Type.String(), side: Type.Union([Type.Literal("old"), Type.Literal("new")]), line: Type.Integer({ minimum: 1 }),
      }), { maxItems: 5 })),
    }),
    async execute(questionToolCallId, params, signal, _update, ctx) {
      if (pending) throw new Error("Only one pending question is allowed");
      if (ctx.mode !== "rpc" || !ctx.hasUI) throw new Error("Dispatch RPC UI is required");
      pending = true;
      answeredQuestion = null;
      try {
        const value = await ctx.ui.input("dispatch.quiz.answer", "Answer in Dispatch", { signal });
        if (value === undefined || signal?.aborted) throw new Error("Quiz cancelled");
        const answer = JSON.parse(value);
        if (!(answer.choice === null || (Number.isInteger(answer.choice) && answer.choice >= 0 && answer.choice < params.choices.length)) || typeof answer.explanation !== "string" || (answer.choice === null && !answer.explanation.trim())) throw new Error("Invalid answer");
        const result = { questionToolCallId, choice: answer.choice === null ? null : params.choices[answer.choice], explanation: answer.explanation.trim() };
        answeredQuestion = questionToolCallId;
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      } finally { pending = false; }
    },
  }));
  pi.registerTool(defineTool({
    name: "report_assessment",
    label: "Assess answer",
    exposure: "model-only",
    description: "Report pass or fail and a short reason for the latest human answer. Use its exact questionToolCallId from the present_question result. Report once, before asking another question; never assess a pending or earlier question.",
    parameters: Type.Object({
      questionToolCallId: Type.String({ minLength: 1 }),
      verdict: Type.Union([Type.Literal("pass"), Type.Literal("fail")]),
      reason: Type.String({ minLength: 1, maxLength: 2000 }),
    }),
    async execute(_id, assessment) {
      if (pending || answeredQuestion === null || assessment.questionToolCallId !== answeredQuestion) throw new Error("Only the latest actually answered question can be assessed once, before the next question");
      if (!assessment.reason.trim()) throw new Error("Assessment reason cannot be blank");
      answeredQuestion = null;
      const result = { ...assessment, reason: assessment.reason.trim() };
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  }));
}
