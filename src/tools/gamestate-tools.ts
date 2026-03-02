import mineflayer from 'mineflayer';
import { ToolFactory } from '../tool-factory.js';
import { BotConnection } from '../bot-connection.js';

export function registerGameStateTools(factory: ToolFactory, getBot: () => mineflayer.Bot, connection?: BotConnection): void {
  factory.registerTool(
    "detect-gamemode",
    "Detect the gamemode on game",
    {},
    async () => {
      const bot = getBot();
      return factory.createResponse(`Bot gamemode: "${bot.game.gameMode}"`);
    }
  );

  factory.registerTool(
    "get-health",
    "Get the bot's current health, food, and experience level",
    {},
    async () => {
      const bot = getBot();
      return factory.createResponse(
        `Health: ${Math.round(bot.health)}/20 | Food: ${bot.food}/20 | Level: ${bot.experience?.level ?? 0}`
      );
    }
  );
}
