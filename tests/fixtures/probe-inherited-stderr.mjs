import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
if (process.argv[2] === 'leaf') {
  const server = createServer((request, response) => {
    response.end(request.url === '/stop' ? 'stopped' : 'alive');
    if (request.url === '/stop') server.close();
  });
  server.listen(0, '127.0.0.1', () => process.send({ endpoint: `http://127.0.0.1:${server.address().port}` }, () => process.disconnect()));
} else {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'leaf'], {
    detached: true, windowsHide: true, stdio: ['ignore', 'ignore', process.stderr, 'ipc'],
  });
  child.once('message', async report => {
    await writeFile(process.argv[2], JSON.stringify(report));
    child.unref();
  });
}
