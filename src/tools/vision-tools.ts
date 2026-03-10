import { z } from "zod";
import mineflayer from 'mineflayer';
import { Vec3 } from 'vec3';
import { ToolFactory } from '../tool-factory.js';

/**
 * Block-to-character mapping for the text map.
 * Prioritizes readability: common blocks get single distinctive chars.
 */
const BLOCK_CHARS: Record<string, string> = {
  // Terrain
  'air': ' ',
  'cave_air': ' ',
  'void_air': ' ',
  'grass_block': '.',
  'dirt': ',',
  'coarse_dirt': ',',
  'podzol': ',',
  'stone': '#',
  'deepslate': '#',
  'cobblestone': '%',
  'mossy_cobblestone': '%',
  'sand': ':',
  'red_sand': ':',
  'gravel': ';',
  'clay': '~',
  'mud': '~',
  'snow_block': '*',
  'snow': '*',
  'ice': '=',
  'packed_ice': '=',
  'blue_ice': '=',

  // Water & lava
  'water': '~',
  'lava': '!',

  // Trees & vegetation
  'oak_log': 'T',
  'spruce_log': 'T',
  'birch_log': 'T',
  'jungle_log': 'T',
  'acacia_log': 'T',
  'dark_oak_log': 'T',
  'mangrove_log': 'T',
  'cherry_log': 'T',
  'oak_leaves': '^',
  'spruce_leaves': '^',
  'birch_leaves': '^',
  'jungle_leaves': '^',
  'acacia_leaves': '^',
  'dark_oak_leaves': '^',
  'mangrove_leaves': '^',
  'cherry_leaves': '^',
  'azalea_leaves': '^',
  'short_grass': '.',
  'tall_grass': '"',
  'fern': '"',
  'large_fern': '"',
  'sweet_berry_bush': 'b',
  'dead_bush': '\'',

  // Ores (uppercase = valuable)
  'coal_ore': 'c',
  'deepslate_coal_ore': 'c',
  'iron_ore': 'I',
  'deepslate_iron_ore': 'I',
  'gold_ore': 'G',
  'deepslate_gold_ore': 'G',
  'diamond_ore': 'D',
  'deepslate_diamond_ore': 'D',
  'emerald_ore': 'E',
  'deepslate_emerald_ore': 'E',
  'lapis_ore': 'L',
  'deepslate_lapis_ore': 'L',
  'redstone_ore': 'R',
  'deepslate_redstone_ore': 'R',
  'copper_ore': 'C',
  'deepslate_copper_ore': 'C',

  // Wood & building
  'oak_planks': '+',
  'spruce_planks': '+',
  'birch_planks': '+',
  'jungle_planks': '+',
  'acacia_planks': '+',
  'dark_oak_planks': '+',
  'crafting_table': 'W',
  'furnace': 'F',
  'chest': '$',
  'barrel': '$',
  'bed': 'B',
  'torch': 'i',
  'wall_torch': 'i',
  'lantern': 'i',

  // Doors & openings
  'oak_door': 'd',
  'spruce_door': 'd',
  'birch_door': 'd',
  'iron_door': 'd',

  // Flowers
  'dandelion': 'f',
  'poppy': 'f',
  'blue_orchid': 'f',
  'allium': 'f',
  'azure_bluet': 'f',
  'oxeye_daisy': 'f',
  'cornflower': 'f',
  'lily_of_the_valley': 'f',

  // Misc
  'bedrock': 'X',
  'obsidian': 'O',
  'netherrack': 'n',
  'end_stone': 'e',
};

function blockToChar(blockName: string | null): string {
  if (!blockName) return '?';
  if (BLOCK_CHARS[blockName]) return BLOCK_CHARS[blockName]!;
  // Fallback heuristics
  if (blockName.includes('ore')) return 'o';
  if (blockName.includes('log') || blockName.includes('wood')) return 'T';
  if (blockName.includes('leaves')) return '^';
  if (blockName.includes('plank')) return '+';
  if (blockName.includes('stone') || blockName.includes('brick')) return '#';
  if (blockName.includes('sand')) return ':';
  if (blockName.includes('glass')) return '0';
  if (blockName.includes('wool')) return 'w';
  if (blockName.includes('slab')) return '-';
  if (blockName.includes('stair')) return '/';
  if (blockName.includes('fence')) return '|';
  if (blockName.includes('wall')) return '|';
  return '?';
}

export function registerVisionTools(factory: ToolFactory, getBot: () => mineflayer.Bot): void {
  factory.registerTool(
    "text-map",
    "Get a top-down ASCII map of surrounding blocks. Shows terrain, resources, structures. @ marks your position. N is up.",
    {
      radius: z.number().optional().describe("Map radius in blocks (default: 12, max: 24)"),
      layer: z.enum(['surface', 'feet', 'below']).optional().describe("Which Y level to map: 'surface' scans from above (default), 'feet' shows your Y level, 'below' shows one block under feet"),
    },
    async ({ radius = 12, layer = 'surface' }: { radius?: number; layer?: 'surface' | 'feet' | 'below' }) => {
      const bot = getBot();
      const pos = bot.entity.position;
      const r = Math.min(Math.max(radius, 4), 24);

      const lines: string[] = [];

      // Header
      lines.push(`Map (${r*2+1}×${r*2+1}) centered on [${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)}] | N↑`);
      lines.push('');

      // Compass
      lines.push(`${'N'.padStart(r + 2)}`);

      // Entity positions for overlay
      const entityPositions = new Map<string, string>();
      for (const entity of Object.values(bot.entities)) {
        if (entity === bot.entity) continue;
        if (!entity.position) continue;
        const dx = Math.round(entity.position.x - pos.x);
        const dz = Math.round(entity.position.z - pos.z);
        if (Math.abs(dx) <= r && Math.abs(dz) <= r) {
          const key = `${dx},${dz}`;
          const type = entity.type;
          if (type === 'player') entityPositions.set(key, 'P');
          else if (type === 'mob' || type === 'hostile') entityPositions.set(key, 'M');
          else if (!entityPositions.has(key)) entityPositions.set(key, '·');
        }
      }

      // Build the map: -z = north (top), +z = south (bottom)
      for (let dz = -r; dz <= r; dz++) {
        let line = '';
        for (let dx = -r; dx <= r; dx++) {
          // Player position
          if (dx === 0 && dz === 0) {
            line += '@';
            continue;
          }

          // Entity overlay
          const entityKey = `${dx},${dz}`;
          if (entityPositions.has(entityKey)) {
            line += entityPositions.get(entityKey);
            continue;
          }

          // Block lookup
          const checkX = Math.floor(pos.x) + dx;
          const checkZ = Math.floor(pos.z) + dz;
          let checkY: number;

          if (layer === 'feet') {
            checkY = Math.floor(pos.y);
          } else if (layer === 'below') {
            checkY = Math.floor(pos.y) - 1;
          } else {
            // Surface mode: scan down from player's Y to find first non-air
            checkY = Math.floor(pos.y);
            for (let dy = 2; dy >= -3; dy--) {
              const block = bot.blockAt(new Vec3(checkX, Math.floor(pos.y) + dy, checkZ));
              if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
                checkY = Math.floor(pos.y) + dy;
                break;
              }
            }
          }

          const block = bot.blockAt(new Vec3(checkX, checkY, checkZ));
          line += blockToChar(block?.name ?? null);
        }

        // Add W/E markers on the center row
        if (dz === 0) {
          line = 'W ' + line + ' E';
        } else {
          line = '  ' + line;
        }

        lines.push(line);
      }

      // South marker
      lines.push(`${'S'.padStart(r + 4)}`);

      // Legend
      lines.push('');
      lines.push('Legend: @ you  . grass  # stone  T tree  ^ leaves  ~ water  ! lava');
      lines.push('  $ chest  W crafting  F furnace  D diamond  I iron  G gold  P player  M mob');

      return factory.createResponse(lines.join('\n'));
    }
  );
}
