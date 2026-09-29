import { spawnSync } from 'node:child_process';

// 운영체제의 기본 프로그램(HTML이면 기본 브라우저)으로 파일을 여는 명령.
export function openerFor(platform, file) {
  if (platform === 'darwin') return { command: 'open', args: [file] };
  // start의 첫 인자는 창 제목이라 빈 제목을 먼저 넘긴다.
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '""', file] };
  return { command: 'xdg-open', args: [file] };
}

// SPEC_OPEN_COMMAND를 주면 그 명령에 파일 경로 하나만 넘긴다. 테스트나 다른 뷰어로 열 때 쓴다.
// 여는 명령은 곧바로 돌아오므로 결과를 기다려 실패를 알린다.
export function openFile(file, { platform = process.platform, env = process.env } = {}) {
  const { command, args } = env.SPEC_OPEN_COMMAND ? { command: env.SPEC_OPEN_COMMAND, args: [file] } : openerFor(platform, file);
  const result = spawnSync(command, args, { stdio: 'ignore', timeout: 10000 });
  if (result.error) return { opened: false, reason: result.error.message };
  if (result.status !== 0) return { opened: false, reason: `${command}가 ${result.status}로 끝났습니다` };
  return { opened: true };
}
