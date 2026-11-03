import { blight, cureWounds } from './lifeRecipes.js';
import { acidSplash, acidSplashImpact, fogCloud, stinkingCloud } from './conjurationRecipes.js';
import { magicMissile, magicMissileImpact, shatter } from './arcaneRecipes.js';
import { fireball, fireballExplosion } from './fireRecipes.js';
import { wallOfFire } from './fireWallRecipes.js';
import { meteorSwarm } from './meteorRecipes.js';
import { coneOfCold, iceStorm } from './frostRecipes.js';
import { moonbeam, sunbeam } from './radianceRecipes.js';
import { lightningBolt, thunderwave } from './stormRecipes.js';
import { bogGasFlame } from './bogRecipes.js';
import { rainCall, tidalOrb, tidalOrbImpact, waterySphere } from './waterRecipes.js';

/** Every recipe by id, including the impacts that projectiles spawn. */
export const EFFECT_RECIPES = Object.freeze({
  fireball,
  fireballExplosion,
  thunderwave,
  lightningBolt,
  coneOfCold,
  iceStorm,
  acidSplash,
  acidSplashImpact,
  magicMissile,
  magicMissileImpact,
  shatter,
  blight,
  cureWounds,
  fogCloud,
  stinkingCloud,
  wallOfFire,
  meteorSwarm,
  moonbeam,
  sunbeam,
  bogGasFlame,
  tidalOrb,
  tidalOrbImpact,
  rainCall,
  waterySphere,
});
