/**
 * Two loopback ports, and only one of them is trusted.
 *
 * The problem this solves: `tailscale serve` runs inside tailscaled on THIS
 * machine and connects to the app over loopback, so a request forwarded from
 * the far side of the tailnet arrives with `remoteAddress` 127.0.0.1 — exactly
 * like a request from a local tool. "Is the peer on loopback" therefore cannot
 * tell the two apart, and anything resting on it would hand every tailnet
 * visitor whatever a local tool is allowed to do.
 *
 * The port a connection arrived on can't be claimed by the client, though. So
 * the app listens twice, on loopback both times:
 *
 *   TRUSTED_PORT  what the CLI, the MCP server and the test suites talk to.
 *                 A request here with no session is the owner.
 *   PUBLIC_PORT   what `tailscale serve` is pointed at. A request here is
 *                 whoever its cookie says it is, and nobody without one.
 *
 * Nothing on the tailnet can reach TRUSTED_PORT: serve only forwards to the one
 * it was given, and neither socket is bound off-machine.
 */
export const TRUSTED_PORT = Number(process.env.PORT || 8787)
export const PUBLIC_PORT = Number(process.env.PLANNER_PUBLIC_PORT || 8789)
