use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(version, about = "Ferropi native Pi session mounts")]
struct Args {
    #[arg(long, global = true)]
    state_dir: Option<PathBuf>,
    #[arg(long, global = true, default_value = "pi")]
    pi: PathBuf,
    #[arg(long, global = true, allow_hyphen_values = true)]
    pi_arg: Vec<String>,
    #[command(subcommand)]
    command: Action,
}
#[derive(Subcommand)]
enum Action {
    /// Send one native Pi command through the lazy daemon, then detach.
    Rpc {
        #[arg(long)]
        session: PathBuf,
        #[arg(long)]
        cwd: Option<PathBuf>,
        #[arg(long)]
        request: String,
    },
    /// Mount until stdin closes; stdin/stdout carry JSONL commands and records.
    Mount {
        #[arg(long)]
        session: PathBuf,
        #[arg(long)]
        cwd: Option<PathBuf>,
    },
    /// Fork a settled native session into a separate mount until stdin closes.
    Fork {
        #[arg(long)]
        session: PathBuf,
        #[arg(long)]
        cwd: Option<PathBuf>,
    },
    #[command(name = "__serve", hide = true)]
    Serve,
}

#[cfg(unix)]
#[tokio::main]
async fn main() -> Result<()> {
    use ferropi::{Client, Config, MountRequest, read_record, write_record};
    use serde_json::{Value, json};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let args = Args::parse();
    let state_dir = args.state_dir.unwrap_or_else(|| {
        directories::BaseDirs::new()
            .expect("user cache directory")
            .cache_dir()
            .join("ferropi")
    });
    let state_dir = if state_dir.is_absolute() {
        state_dir
    } else {
        std::env::current_dir()?.join(state_dir)
    };
    let config = Config {
        state_dir,
        pi: args.pi,
        pi_args: args.pi_arg,
        executable: std::env::current_exe()?,
    };
    let (session, cwd, request, fork) = match args.command {
        Action::Serve => return ferropi::serve(config).await,
        Action::Rpc {
            session,
            cwd,
            request,
        } => (session, cwd, Some(request), false),
        Action::Mount { session, cwd } => (session, cwd, None, false),
        Action::Fork { session, cwd } => (session, cwd, None, true),
    };
    let mount = MountRequest {
        session,
        cwd: cwd.unwrap_or(std::env::current_dir()?),
        pi_args: None,
    };
    let mut client = if fork {
        Client::fork(&config, mount).await?
    } else {
        Client::mount(&config, mount).await?
    };
    let mut stdout = tokio::io::stdout();
    if let Some(request) = request {
        let mut value: Value = serde_json::from_str(&request)?;
        value["id"] = json!("cli");
        write_record(&mut client.writer, &value).await?;
        loop {
            let record = read_record(&mut client.reader)
                .await?
                .ok_or_else(|| anyhow::anyhow!("daemon disconnected before response"))?;
            write_record(&mut stdout, &record).await?;
            if record["type"] == "response" && record["id"] == "cli" {
                if record["success"] != true {
                    anyhow::bail!("Pi command failed");
                }
                break;
            }
        }
    } else {
        write_record(&mut stdout, &client.mounted).await?;
        let mut input = BufReader::new(tokio::io::stdin()).lines();
        let mut output = client.reader.lines();
        loop {
            tokio::select! {
                line = input.next_line() => {
                    let Some(line) = line? else { break; };
                    write_record(&mut client.writer, &serde_json::from_str::<Value>(&line)?).await?;
                }
                line = output.next_line() => {
                    let Some(line) = line? else { break; };
                    stdout.write_all(line.as_bytes()).await?;
                    stdout.write_all(b"\n").await?;
                    stdout.flush().await?;
                }
            }
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn main() -> Result<()> {
    anyhow::bail!(
        "Initial Ferropi transport targets macOS/Linux; Windows named-pipe transport is not implemented yet"
    )
}
