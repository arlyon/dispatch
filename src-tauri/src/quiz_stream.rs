//! Ordered Quiz text/answer segments. Pi's delta-only blocks reconcile in place.
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum QuizSegment {
    Text {
        id: String,
        text: String,
    },
    Answer {
        id: String,
        question_tool_call_id: String,
    },
}
#[derive(Default)]
pub(crate) struct QuizTranscript {
    pub segments: Vec<QuizSegment>,
    blocks: BTreeMap<usize, String>,
    active_text: Option<usize>,
    next_text: usize,
}
impl QuizTranscript {
    pub fn apply(&mut self, record: &Value) -> bool {
        match record["type"].as_str() {
            Some("message_start") if record["message"]["role"] == "assistant" => {
                self.blocks.clear();
                self.active_text = None;
                self.read_blocks(&record["message"]);
                self.reconcile_text();
                true
            }
            Some("message_update") => {
                let event = &record["assistantMessageEvent"];
                let Some(index) = event["contentIndex"].as_u64().map(|index| index as usize) else {
                    return false;
                };
                match event["type"].as_str() {
                    Some("text_start") => {
                        self.blocks.insert(index, String::new());
                    }
                    Some("text_delta") => {
                        if let Some(delta) = event["delta"].as_str() {
                            self.blocks.entry(index).or_default().push_str(delta);
                        }
                    }
                    Some("text_end") => {
                        if let Some(text) = event["content"].as_str() {
                            self.blocks.insert(index, text.into());
                        }
                    }
                    _ => return false,
                }
                self.reconcile_text();
                true
            }
            Some("message_end") if record["message"]["role"] == "assistant" => {
                self.blocks.clear();
                self.read_blocks(&record["message"]);
                self.reconcile_text();
                self.blocks.clear();
                self.active_text = None;
                true
            }
            _ => false,
        }
    }
    pub fn answered(&mut self, question_tool_call_id: &str) {
        self.segments.push(QuizSegment::Answer {
            id: format!("answer-{question_tool_call_id}"),
            question_tool_call_id: question_tool_call_id.into(),
        });
    }
    fn read_blocks(&mut self, message: &Value) {
        if let Some(blocks) = message["content"].as_array() {
            for (index, block) in blocks.iter().enumerate() {
                if block["type"] == "text"
                    && let Some(text) = block["text"].as_str()
                {
                    self.blocks.insert(index, text.into());
                }
            }
        }
    }
    fn reconcile_text(&mut self) {
        let text = self
            .blocks
            .values()
            .filter(|text| !text.is_empty())
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        if let Some(index) = self.active_text {
            if let QuizSegment::Text { text: previous, .. } = &mut self.segments[index] {
                *previous = text;
            }
        } else if !text.is_empty() {
            self.next_text += 1;
            self.active_text = Some(self.segments.len());
            self.segments.push(QuizSegment::Text {
                id: format!("text-{}", self.next_text),
                text,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn texts(stream: &QuizTranscript) -> Vec<&str> {
        stream
            .segments
            .iter()
            .filter_map(|segment| match segment {
                QuizSegment::Text { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }
    fn delta(stream: &mut QuizTranscript, text: &str) {
        stream.apply(&json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":text}}));
    }
    fn finish(stream: &mut QuizTranscript, text: &str) {
        stream.apply(&json!({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":text}]}}));
    }
    #[test]
    fn delta_only_blocks_and_authoritative_finals_reconcile_the_same_text_segment() {
        let mut stream = QuizTranscript::default();
        stream.apply(&json!({"type":"message_start","message":{"role":"assistant","content":[]}}));
        delta(&mut stream, "Draft ");
        delta(&mut stream, "reason λ");
        assert_eq!(texts(&stream), ["Draft reason λ"]);
        let id = serde_json::to_value(&stream.segments[0]).unwrap()["id"].clone();
        stream.apply(&json!({"type":"message_update","assistantMessageEvent":{"type":"text_end","contentIndex":0,"content":"Corrected reason"}}));
        stream.apply(&json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":2,"delta":"Second block"}}));
        assert_eq!(texts(&stream), ["Corrected reason\nSecond block"]);
        finish(&mut stream, "Authoritative explanation");
        assert_eq!(texts(&stream), ["Authoritative explanation"]);
        assert_eq!(serde_json::to_value(&stream.segments[0]).unwrap()["id"], id);
        delta(&mut stream, "Next");
        finish(&mut stream, "Next");
        assert_eq!(texts(&stream), ["Authoritative explanation", "Next"]);
    }
    #[test]
    fn answers_stay_before_every_follow_up_token_and_later_turn() {
        let mut stream = QuizTranscript::default();
        finish(&mut stream, "Introduction before the answer");
        stream.answered("q1");
        for token in ["Correct", ", because", " snapshots"] {
            delta(&mut stream, token);
            assert!(
                matches!(&stream.segments[..], [QuizSegment::Text { .. }, QuizSegment::Answer { question_tool_call_id, .. }, QuizSegment::Text { .. }] if question_tool_call_id == "q1")
            );
        }
        finish(&mut stream, "Correct, because snapshots are pinned.");
        stream.answered("q2");
        delta(&mut stream, "Second feedback");
        finish(&mut stream, "Second feedback");
        assert!(
            matches!(&stream.segments[..], [QuizSegment::Text { .. }, QuizSegment::Answer { .. }, QuizSegment::Text { .. }, QuizSegment::Answer { question_tool_call_id, .. }, QuizSegment::Text { .. }] if question_tool_call_id == "q2")
        );
        assert_eq!(
            texts(&stream),
            [
                "Introduction before the answer",
                "Correct, because snapshots are pinned.",
                "Second feedback"
            ]
        );
    }
    #[test]
    fn tool_fragments_and_thinking_never_become_visible_prose_or_answers() {
        let mut stream = QuizTranscript::default();
        for kind in [
            "toolcall_start",
            "toolcall_delta",
            "toolcall_end",
            "thinking_delta",
        ] {
            assert!(!stream.apply(&json!({"type":"message_update","assistantMessageEvent":{"type":kind,"contentIndex":0,"toolName":"present_question","delta":"{\"question\":\"unfinished","toolCall":{"arguments":{"choices":["A"]}}}})));
        }
        assert!(stream.segments.is_empty());
        finish(&mut stream, "Final-only response");
        assert_eq!(texts(&stream), ["Final-only response"]);
    }
    #[test]
    #[ignore = "requires DISPATCH_QUIZ_NATIVE_EVENTS from tests/quiz.native.cjs"]
    fn actual_native_events_keep_answer_markers_before_feedback() {
        let records: Vec<Value> = serde_json::from_slice(
            &std::fs::read(std::env::var("DISPATCH_QUIZ_NATIVE_EVENTS").unwrap()).unwrap(),
        )
        .unwrap();
        let mut stream = QuizTranscript::default();
        let mut answered = 0;
        for record in records {
            stream.apply(&record);
            if record["type"] == "tool_execution_end"
                && record["toolName"] == "present_question"
                && record["isError"] == false
            {
                stream.answered(record["toolCallId"].as_str().unwrap());
                answered += 1;
            }
        }
        assert_eq!(answered, 2);
        let entries = serde_json::to_value(&stream.segments).unwrap();
        assert_eq!(entries[0]["questionToolCallId"], "quiz-q1");
        let second = entries
            .as_array()
            .unwrap()
            .iter()
            .position(|entry| entry["questionToolCallId"] == "quiz-q2")
            .unwrap();
        assert!(second > 1);
        assert!(
            entries[1]["text"]
                .as_str()
                .unwrap()
                .contains("Your reasoning")
        );
        assert!(
            entries[second + 1]["text"]
                .as_str()
                .unwrap()
                .contains("immutable snapshots")
        );
    }
}
