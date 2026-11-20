// 아주 작은 정적 파일 서버.
//
// 왜 굳이 서버를 띄우는가:
//  - 마이크(getUserMedia)는 "보안 컨텍스트"에서만 열린다. index.html을 file:// 로 더블클릭해
//    열면 브라우저가 마이크를 막는다. http://localhost 는 예외적으로 보안 컨텍스트로 쳐준다.
//
// 왜 Node로 직접 짜는가:
//  - 이 PC의 파이썬은 마이크로소프트 스토어 껍데기라 스크립트가 조용히 안 돈다.
//  - 외부 패키지를 쓰지 않는다(npm install 없이 바로 돈다).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const PORT = 5173;
const ROOT = process.cwd();
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const full = join(ROOT, normalize(p));
    // 상위 폴더로 빠져나가지 못하게 막는다 (../../ 같은 경로)
    if (full !== ROOT && !full.startsWith(ROOT + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('403');
      return;
    }
    const body = await readFile(full);
    res.writeHead(200, {
      'content-type': TYPES[extname(full).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store', // 고치면 새로고침만으로 바로 반영되도록
    }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
  }
}).listen(PORT, () => {
  console.log('블루베리 노래방: http://localhost:' + PORT);
});
