import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

export interface ServerConfig {
  host: string;
  port: number;
  username: string;
  auth: 'microsoft' | 'offline';
  profilesFolder: string;
}

export function parseConfig(): ServerConfig {
  const parsed = yargs(hideBin(process.argv))
    .option('host', {
      type: 'string',
      description: 'Minecraft server host',
      default: 'localhost'
    })
    .option('port', {
      type: 'number',
      description: 'Minecraft server port',
      default: 25565
    })
    .option('username', {
      type: 'string',
      description: 'Bot username',
      default: 'LLMBot'
    })
    .option('auth', {
      type: 'string',
      description: 'Authentication method (microsoft or offline)',
      choices: ['microsoft', 'offline'] as const,
      default: 'offline' as const
    })
    .option('profiles-folder', {
      type: 'string',
      description: 'Directory to cache auth tokens',
      default: './minecraft-auth'
    })
    .help()
    .alias('help', 'h')
    .parseSync();

  return {
    host: parsed.host,
    port: parsed.port,
    username: parsed.username,
    auth: parsed.auth,
    profilesFolder: parsed['profiles-folder'],
  };
}
