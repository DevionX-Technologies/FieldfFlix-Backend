const { spawn } = require('child_process');

const ssh = spawn('ssh', [
  '-tt',
  '-o',
  'StrictHostKeyChecking=no',
  '-o',
  'PreferredAuthentications=password',
  '-o',
  'PubkeyAuthentication=no',
  'admin@100.72.200.32',
]);

let passwordSent = false;

ssh.stdout.on('data', (data) => {
  const str = data.toString();
  process.stdout.write(str);
  if (str.toLowerCase().includes('password') && !passwordSent) {
    ssh.stdin.write('1234\n');
    passwordSent = true;
  }
});

ssh.stderr.on('data', (data) => {
  const str = data.toString();
  process.stderr.write(str);
  if (str.toLowerCase().includes('password') && !passwordSent) {
    ssh.stdin.write('1234\n');
    passwordSent = true;
  }
});

ssh.on('close', (code) => {
  console.log(`SSH session finished with exit code ${code}`);
});

setTimeout(() => {
  if (passwordSent) {
    ssh.stdin.write('echo "=== Current Directory Content ==="\n');
    ssh.stdin.write('cd /home/admin/fieldflicks-delhi && ls -la\n');
    ssh.stdin.write('echo "=== Searching for files containing af05d0c6 ==="\n');
    ssh.stdin.write('find /home/admin -name "*af05d0c6*"\n');
    ssh.stdin.write('echo "=== Listing all media files ==="\n');
    ssh.stdin.write(
      'find /home/admin -name "*.mp4" -o -name "*.mp3" -o -name "*.wav"\n',
    );
    ssh.stdin.write('echo "=== Gunicorn logs ==="\n');
    ssh.stdin.write('sudo journalctl | grep -i gunicorn | tail -n 50\n');
    ssh.stdin.write('exit\n');
  } else {
    console.error('Password prompt not detected in time.');
    ssh.kill();
  }
}, 4000);
