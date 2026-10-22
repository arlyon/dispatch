//! Test fixture only; never calls a provider or executes tools.
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let option = |name: &str| {
        args.windows(2)
            .find(|pair| pair[0] == name)
            .map(|pair| std::path::PathBuf::from(&pair[1]))
    };
    let session = if let Some(source) = option("--fork") {
        let path = source.with_file_name(format!("fork-{}.jsonl", std::process::id()));
        std::fs::copy(source, &path).unwrap();
        path
    } else {
        option("--session").unwrap_or_else(|| "unpersisted.jsonl".into())
    };
    let mut name = Value::Null;
    let mut delayed = None;
    for line in io::stdin().lock().lines() {
        let request: Value = serde_json::from_str(&line.unwrap()).unwrap();
        let kind = request["type"].as_str().unwrap();
        let data = match kind {
            "get_state" => {
                json!({"pid":std::process::id(),"isStreaming":false,"isCompacting":false,"pendingMessageCount":0,"sessionFile":session,"sessionName":name,"argv":args})
            }
            "get_messages" => json!({"messages":[]}),
            "prompt" => json!({"disposition":"started"}),
            _ => json!({}),
        };
        let response =
            json!({"type":"response","id":request["id"],"command":kind,"success":true,"data":data});
        match request["name"].as_str() {
            Some("crash") => std::process::exit(17),
            Some("malformed") => {
                println!("not json");
                io::stdout().flush().unwrap();
                continue;
            }
            Some("never") => continue,
            Some("delay") => {
                delayed = Some(response);
                println!("{}", json!({"type":"test_delayed"}));
                io::stdout().flush().unwrap();
                continue;
            }
            _ => {}
        }
        if kind == "set_session_name" {
            name = request["name"].clone();
        }
        // Exercise CRLF framing alongside LF events.
        print!("{response}\r\n");
        if request["name"] == "busy" {
            println!("{}", json!({"type":"agent_start"}));
            println!("{}", json!({"type":"agent_end","willRetry":true}));
        } else if request["name"] == "settle" {
            println!("{}", json!({"type":"agent_settled","aborted":false}));
        }
        if let Some(response) = delayed.take() {
            println!("{response}");
        }
        if kind == "prompt" {
            println!(
                "{}",
                json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":request["message"]}})
            );
            println!("{}", json!({"type":"agent_end","willRetry":true}));
            println!("{}", json!({"type":"agent_settled","aborted":false}));
        }
        io::stdout().flush().unwrap();
    }
}
