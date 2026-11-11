import { frameUniform as uniform } from '../../../render/FrameUniforms.js';

/** 0..1 snow a storm has laid (SnowCover), read by the terrain, canopy and rock snow. */
export const stormSnowCoverUniform = uniform(0);

/** 0..1 rain falling now (StormState frame `rain`), for the puddle ripples. */
export const stormRainUniform = uniform(0);

/** 0..1 eased storm level (StormState frame `storm`), for what the wind may bend. */
export const stormLevelUniform = uniform(0);
