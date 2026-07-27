import yaml from 'js-yaml';
import itemsYaml from '../../../config/items.yaml?raw';
import startingLoadoutYaml from '../../../config/player-starting-loadout.yaml?raw';
import { ItemCatalog } from './ItemCatalog.js';

export const ITEM_CATALOG = ItemCatalog.fromDocument(yaml.load(itemsYaml));

export const PLAYER_STARTING_LOADOUT = Object.freeze(
  structuredClone(yaml.load(startingLoadoutYaml)),
);
