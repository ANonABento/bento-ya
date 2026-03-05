# T052: Discord Bot Foundation

## Summary

Set up the Discord bot infrastructure as a Tauri sidecar. The bot connects to Discord, handles basic events, and communicates with Bento-ya via IPC.

## Acceptance Criteria

- [ ] Discord.js bot runs as Tauri sidecar (Node.js process)
- [ ] Bot connects with token from settings
- [ ] Sidecar spawns on app start (if Discord enabled)
- [ ] Sidecar gracefully shuts down on app close
- [ ] Basic IPC bridge: Rust ↔ Node.js via stdin/stdout JSON
- [ ] Bot responds to ping command (test connectivity)
- [ ] Connection status events emitted to frontend

## Technical Design

### Sidecar Structure

```
src-tauri/
├── sidecars/
│   └── discord-bot/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts      # Entry point
│           ├── bridge.ts     # IPC with Rust
│           ├── client.ts     # Discord.js setup
│           └── handlers/
│               └── message.ts
```

### IPC Protocol (JSON over stdin/stdout)

```typescript
// Rust → Node (commands)
interface BridgeCommand {
  id: string;           // For response correlation
  type: 'connect' | 'disconnect' | 'send_message' | 'create_thread' | ...;
  payload: any;
}

// Node → Rust (responses/events)
interface BridgeResponse {
  id: string;           // Correlates to command
  success: boolean;
  data?: any;
  error?: string;
}

interface BridgeEvent {
  type: 'message' | 'ready' | 'error' | 'disconnect';
  payload: any;
}
```

### Rust Side

```rust
// src-tauri/src/discord/mod.rs

use std::process::{Child, Command, Stdio};
use std::io::{BufRead, BufReader, Write};
use tokio::sync::mpsc;

pub struct DiscordBridge {
    process: Option<Child>,
    sender: mpsc::Sender<BridgeCommand>,
}

impl DiscordBridge {
    pub fn spawn(token: &str) -> Result<Self, Error> {
        let mut child = Command::new("node")
            .arg("sidecars/discord-bot/dist/index.js")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()?;

        // Setup IPC channels...
    }

    pub async fn send(&self, cmd: BridgeCommand) -> Result<BridgeResponse, Error>;
    pub fn on_event<F>(&self, handler: F) where F: Fn(BridgeEvent);
    pub fn shutdown(&mut self);
}
```

### Node.js Entry Point

```typescript
// sidecars/discord-bot/src/index.ts

import { Client, GatewayIntentBits } from 'discord.js';
import { Bridge } from './bridge';

const bridge = new Bridge(process.stdin, process.stdout);
let client: Client | null = null;

bridge.on('connect', async ({ token }) => {
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on('ready', () => {
    bridge.emit('ready', { user: client.user?.tag });
  });

  client.on('messageCreate', (msg) => {
    bridge.emit('message', {
      id: msg.id,
      channelId: msg.channelId,
      content: msg.content,
      author: msg.author.tag,
    });
  });

  await client.login(token);
});

bridge.on('disconnect', () => {
  client?.destroy();
  client = null;
});
```

## Implementation Steps

1. Create sidecar directory structure
2. Initialize Node.js project with discord.js v14
3. Implement Bridge class (IPC protocol)
4. Implement basic Discord client setup
5. Create Rust `discord` module with process management
6. Add Tauri commands: `connect_discord`, `disconnect_discord`, `get_discord_status`
7. Wire up sidecar spawn on settings change
8. Add connection status to frontend (settings panel)
9. Test ping/pong command

## Files

**New:**
- `src-tauri/sidecars/discord-bot/` (entire directory)
- `src-tauri/src/discord/mod.rs`
- `src-tauri/src/discord/bridge.rs`
- `src-tauri/src/commands/discord.rs`

**Modified:**
- `src-tauri/src/lib.rs` - Add discord module, commands
- `src-tauri/src/commands/mod.rs` - Export discord commands
- `src-tauri/tauri.conf.json` - Configure sidecar

## Dependencies

- discord.js ^14.14.0
- Node.js 18+ (user must have installed)

## Complexity

**M** - New sidecar infrastructure, but pattern is straightforward

## Commit

`feat(discord): add bot foundation with sidecar architecture`
