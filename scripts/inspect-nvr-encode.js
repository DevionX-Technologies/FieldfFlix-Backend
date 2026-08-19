const { spawn } = require('child_process');

const targetIp = '100.121.90.26'; // raspberrypi-court11

console.log(`Connecting to ${targetIp}...`);

const ssh = spawn('ssh', [
  '-tt',
  '-o',
  'StrictHostKeyChecking=no',
  '-o',
  'PreferredAuthentications=password',
  '-o',
  'PubkeyAuthentication=no',
  `admin@${targetIp}`,
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
  console.log(`SSH session closed with code ${code}`);
});

setTimeout(() => {
  if (passwordSent) {
    console.log('Sending inspection commands...');
    // Probe RTSP main and sub stream
    ssh.stdin.write('echo "=== NVR ENCODE CONFIG VIA DAHUA CGI ==="\n');
    ssh.stdin.write(
      'curl -s --digest -u "admin:Chand@12345" "http://192.168.1.245/cgi-bin/configManager.cgi?action=getConfig&name=Encode[0]" | head -n 40\n',
    );
    ssh.stdin.write('echo "=== FFPROBE SUB STREAM (subtype=1) ==="\n');
    ssh.stdin.write(
      'ffprobe -rtsp_transport tcp -v error -show_streams "rtsp://admin:Chand%4012345@192.168.1.245:554/cam/realmonitor?channel=1&subtype=1" -read_intervals "%+5" -timeout 5000000\n',
    );
    ssh.stdin.write('echo "=== FFPROBE MAIN STREAM (subtype=0) ==="\n');
    ssh.stdin.write(
      'ffprobe -rtsp_transport tcp -v error -show_streams "rtsp://admin:Chand%4012345@192.168.1.245:554/cam/realmonitor?channel=1&subtype=0" -read_intervals "%+5" -timeout 5000000\n',
    );
    ssh.stdin.write('echo "=== CURRENT FINAL SETUP ENV ==="\n');
    ssh.stdin.write('cat ~/final_setup/.env\n');
    ssh.stdin.write('exit\n');
  } else {
    console.error('Failed to authenticate in time.');
    ssh.kill();
  }
}, 4000);
