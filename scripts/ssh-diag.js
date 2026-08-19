const { spawn } = require('child_process');

console.log('Connecting to admin@100.119.221.109...');
const ssh = spawn('ssh', [
  '-tt',
  '-o',
  'StrictHostKeyChecking=no',
  '-o',
  'PreferredAuthentications=password',
  '-o',
  'PubkeyAuthentication=no',
  'admin@100.119.221.109',
]);

let passwordSent = false;

ssh.stdout.on('data', (data) => {
  const str = data.toString();
  console.log(`[STDOUT] ${str.trim()}`);
  if (str.toLowerCase().includes('password') && !passwordSent) {
    console.log('[SCRIPT] Sending password...');
    ssh.stdin.write('1234\n');
    passwordSent = true;
  }
});

ssh.stderr.on('data', (data) => {
  const str = data.toString();
  console.log(`[STDERR] ${str.trim()}`);
  if (str.toLowerCase().includes('password') && !passwordSent) {
    console.log('[SCRIPT] Sending password...');
    ssh.stdin.write('1234\n');
    passwordSent = true;
  }
});

ssh.on('close', (code) => {
  console.log(`\n[SCRIPT] SSH session finished with exit code ${code}`);
});

setTimeout(() => {
  if (passwordSent) {
    console.log('\n[SCRIPT] Sending commands...');
    ssh.stdin.write('hostname && whoami\n');
    ssh.stdin.write('df -h\n');
    ssh.stdin.write(
      'ps aux | grep -E "ffmpeg|python|gunicorn|recorder" | grep -v grep\n',
    );
    ssh.stdin.write('ls -la /home/admin\n');
    ssh.stdin.write('exit\n');
  } else {
    console.error('\n[SCRIPT] Password prompt not detected in time.');
    ssh.kill();
  }
}, 8000);
