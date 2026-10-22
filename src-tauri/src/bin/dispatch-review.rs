use dispatch_lib::reviews;
use std::{path::Path, time::Duration};

fn wait_for_feedback(root: &Path, id: &str) -> Result<(), String> {
    reviews::ensure_root(root)?;
    reviews::read_request(root, id)?;
    eprintln!("Waiting for human feedback: {id}");
    loop {
        if let Some(result) = reviews::result(root, id)? {
            println!(
                "{}",
                serde_json::to_string(&result).map_err(|error| error.to_string())?
            );
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|arg| arg == "wait") {
        if args.len() != 2 {
            return Err("Usage: dispatch-review wait REVIEW_ID".into());
        }
        return wait_for_feedback(&reviews::root()?, &args[1]);
    }
    if args.len() < 3 {
        return Err(
            "Usage: dispatch-review REPOSITORY BASE HEAD [--context FILE] [--wait] [--bg]".into(),
        );
    }
    let mut wait = false;
    let mut background = false;
    let mut context = None;
    let mut flags = args[3..].iter();
    while let Some(flag) = flags.next() {
        match flag.as_str() {
            "--wait" if !wait => wait = true,
            "--bg" if !background => background = true,
            "--context" if context.is_none() => {
                let path = flags.next().ok_or("--context requires a JSON file")?;
                let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
                if bytes.len() > 256 * 1024 {
                    return Err("Review context exceeds 256 KiB".into());
                }
                context = Some(
                    serde_json::from_slice::<reviews::ReviewContext>(&bytes)
                        .map_err(|e| e.to_string())?,
                );
            }
            _ => return Err(format!("Unknown or repeated option: {flag}")),
        }
    }
    let root = reviews::root()?;
    let request = reviews::enqueue_with_context(
        &root,
        Path::new(&args[0]),
        &args[1],
        &args[2],
        context.as_ref(),
    )?;
    eprintln!("Queued {} in {}", request.id, root.display());
    if let Err(error) = dispatch_lib::desktop::deliver(&request.id, background) {
        eprintln!("{error}. The immutable review is still queued.");
    }
    if wait {
        wait_for_feedback(&root, &request.id)?;
    } else {
        println!(
            "{}",
            serde_json::to_string(&request).map_err(|e| e.to_string())?
        );
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
