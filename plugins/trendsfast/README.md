# TrendsFast

Sourced market evidence for your agent. Ask what your customers are saying, what is trending in
your niche, what competitors post, which video formats and hooks work, and what AI assistants
answer, and get posts with their source, date and measured signal instead of guesses.

This is the [TrendsFast](https://trendsfast.com) plugin for Cursor, Grok Bot, Claude and Grok
Build: one hosted MCP server and one skill that teaches the agent when to use it. It runs no
code on your machine and it never posts, schedules or messages anyone.

## Install

| Client      | Steps                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cursor      | Install **TrendsFast** from the [Cursor Marketplace](https://cursor.com/marketplace). In **Settings → Tools & MCP**, press **Connect** on `trendsfast`.       |
| Grok Bot    | Open **Plugins**, search for **TrendsFast**, press **Add**, then **Authenticate**. Grok Bot installs from the same marketplace as Cursor.                     |
| Claude Code | `/plugin marketplace add meestierolff/trendsfast-open`, then `/plugin install trendsfast@trendsfast`. Run `/mcp` and choose **Authenticate** on `trendsfast`. |
| Grok Build  | Open `/plugin`, search for **TrendsFast** and install. Open `/mcps`, select it and sign in.                                                                   |

To try it before installing from a marketplace, copy this folder to
`~/.cursor/plugins/local/trendsfast` and reload Cursor.

## Sign in

Your first connection opens trendsfast.com in the browser. Sign in, choose the project the agent
may use, and allow the connection. There is no API key to paste, and nothing should be pasted
into a chat. You can revoke the connection at any time under API keys in your
[dashboard](https://trendsfast.com/dashboard).

A free account comes with monthly credits. See [pricing](https://trendsfast.com/pricing).

## What you get

- **MCP server** `trendsfast` at `https://trendsfast.com/api/mcp/v3/oauth` (Streamable HTTP,
  OAuth 2.1).
- **Skill** `trendsfast`: which product answers which job, how to spend once, and how to report
  with sources and stated gaps.

| Tool                                       | What it does                                                                                                                | Credits          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `trendsfast_niche_trends` with a `product` | Fresh evidence for your confirmed brand: `customers` 10, `niche` (Trending) 25, `formats` 20, `competitors` 30, `search` 35 | 10 to 35         |
| `trendsfast_niche_trends` without one      | The saved index, against your brand or a typed niche                                                                        | 3                |
| `trendsfast_global_trends`                 | The saved index, with no brand                                                                                              | 1                |
| `trendsfast_ask_trends`                    | One question, answered from saved evidence                                                                                  | 5                |
| `trendsfast_discover_trends`               | Every scope and channel of the saved index                                                                                  | 5                |
| `trendsfast_video_outlier`                 | How one video did against its creator's other posts                                                                         | 5, only if found |
| `trendsfast_project_context`               | Your confirmed brand                                                                                                        | Free             |
| `trendsfast_credit_balance`                | Your balance                                                                                                                | Free             |
| `trendsfast_read_result`                   | Reread a saved result                                                                                                       | Free             |
| `trendsfast_community_brief`               | One subreddit read in depth: its people, how to sound, the winning post and reply, its rules                                | Free             |

Each paid call carries a credit cap and a request ID, so a retry never charges twice. An empty
result costs nothing.

## Network and credentials

The plugin declares one endpoint, `https://trendsfast.com`, and holds no credential itself: your
client keeps the sign-in tokens and sends them only to that endpoint. It ships no hooks, commands,
scripts or local servers.

What a call sends is the request itself: the tool's arguments, which can include the niche you
typed or a video's link. See the [privacy policy](https://trendsfast.com/privacy) and
[terms](https://trendsfast.com/terms) for what is stored and for how long.

## Support

[trendsfast.com/support](https://trendsfast.com/support) ·
[Documentation](https://trendsfast.com/docs)

## License

MIT. See [LICENSE](LICENSE).
