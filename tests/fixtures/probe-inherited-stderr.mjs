import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';
import { once } from 'node:events';
if (process.argv[2] === 'leaf') {
  const server = createServer((_request, response) => response.end('alive'));
  const control = connect(Number(process.argv[3]), '127.0.0.1');
  try {
    await once(control, 'connect');
    const ready = new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let stopping = false;
    const stop = async () => {
      if (stopping) return; stopping = true;
      await ready;
      server.close(() => control.end(JSON.stringify({ stopped: true }) + '\n'));
    };
    control.on('data', stop); control.on('end', stop); control.on('error', stop);
    await ready;
    const report = { endpoint: `http://127.0.0.1:${server.address().port}` };
    control.write(JSON.stringify(report) + '\n');
    process.send(report, () => process.disconnect());
  } catch {
    // The test closed admission before this leaf connected. No server started.
    control.destroy(); process.disconnect();
  }
} else {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'leaf', process.argv[3]], {
    detached: true, windowsHide: true, stdio: ['ignore', 'ignore', process.stderr, 'ipc'],
  });
  child.once('message', async report => {
    await writeFile(process.argv[2], JSON.stringify(report));
    child.unref();
  });
}
