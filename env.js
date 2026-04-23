import { readFileSync, writeFileSync } from 'fs';
const lines = readFileSync('.env', 'utf-8').split('\n').filter(Boolean);

const json = lines.map((line) => {
  const [key, ...rest] = line.split('=');
  return {
    Namespace: 'aws:elasticbeanstalk:application:environment',
    OptionName: key.trim(),
    Value: rest.join('=').trim(),
  };
});

writeFileSync('env.json', JSON.stringify(json, null, 2));
console.log('env.json created!');
