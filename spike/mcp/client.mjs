/**
 * Spike: MCP Streamable HTTP client — calls the echo tool on /agent/alice/mcp and /agent/bob/mcp
 * and prints the result, proving:
 *  1. The round-trip works
 *  2. The server correctly identifies which agent called
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function callEcho(agentName, message) {
  const url = new URL(`http://127.0.0.1:3737/agent/${agentName}/mcp`);
  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client(
    { name: `test-client-${agentName}`, version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);

  console.log(`\n[client] Connected to /agent/${agentName}/mcp`);

  const result = await client.callTool({ name: 'echo', arguments: { message } });

  console.log(`[client] Result from ${agentName}:`, JSON.stringify(result, null, 2));

  await client.close();
  return result;
}

async function main() {
  console.log('[client] Starting MCP spike client...');

  // Call echo as alice
  const aliceResult = await callEcho('alice', 'Hello from Alice!');

  // Call echo as bob
  const bobResult = await callEcho('bob', 'Hello from Bob!');

  // Verify identity binding
  const aliceContent = JSON.parse(aliceResult.content[0].text);
  const bobContent = JSON.parse(bobResult.content[0].text);

  console.log('\n=== RESULTS ===');
  console.log('Alice response:', aliceContent);
  console.log('Bob response:  ', bobContent);

  if (aliceContent.agent === 'alice' && aliceContent.echo === 'Hello from Alice!') {
    console.log('[PASS] Alice identity correctly bound');
  } else {
    console.log('[FAIL] Alice identity mismatch:', aliceContent);
    process.exit(1);
  }

  if (bobContent.agent === 'bob' && bobContent.echo === 'Hello from Bob!') {
    console.log('[PASS] Bob identity correctly bound');
  } else {
    console.log('[FAIL] Bob identity mismatch:', bobContent);
    process.exit(1);
  }

  console.log('\n[DONE] Round-trip + per-path identity PROVEN');
}

main().catch(err => {
  console.error('[client] Fatal error:', err);
  process.exit(1);
});
