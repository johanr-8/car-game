/**
 * src/world/TimeOfDay.ts
 * ─────────────────────────────────────────────────────────────
 * Real-Life Daytime and Golden Hour Lighting Themes:
 *   - Vibrant blue skies, warm golden sunlight, realistic asphalt and architecture
 *   - Zero pitch-black darkness: Hemisphere fill light illuminates all geometry
 * ─────────────────────────────────────────────────────────────
 */

export interface CityTheme {
  name: string;
  skyColor: number;
  fogColor: number;
  fogDensity: number;
  hemiSkyColor: number;
  hemiGroundColor: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  roadColor: number;
  grassColor: number;
  curbColorA: number;
  curbColorB: number;
  waterColor: number;
  moonColor: number;
}

export const CITY_THEMES: CityTheme[] = [
  {
    name: 'VIBRANT DAYLIGHT',
    skyColor: 0x4a94e8,
    fogColor: 0x82bcf0,
    fogDensity: 0.0006,
    hemiSkyColor: 0x90caff,
    hemiGroundColor: 0x4d683a,
    hemiIntensity: 1.3,
    sunColor: 0xfffae8,
    sunIntensity: 2.8,
    roadColor: 0x343a46,
    grassColor: 0x3d6e32,
    curbColorA: 0xd62828, // racing red
    curbColorB: 0xffffff, // racing white
    waterColor: 0x1d7ea8,
    moonColor: 0xd8e4f0,
  },
  {
    name: 'GOLDEN HOUR',
    skyColor: 0xe87848,
    fogColor: 0xf5a278,
    fogDensity: 0.0007,
    hemiSkyColor: 0xffb588,
    hemiGroundColor: 0x5a4830,
    hemiIntensity: 1.25,
    sunColor: 0xffd288,
    sunIntensity: 3.0,
    roadColor: 0x363038,
    grassColor: 0x485c2c,
    curbColorA: 0xe63946,
    curbColorB: 0xfff0db,
    waterColor: 0x9e5230,
    moonColor: 0xffe2b8,
  },
  {
    name: 'TROPICAL COAST',
    skyColor: 0x24a8d8,
    fogColor: 0x76cce8,
    fogDensity: 0.0006,
    hemiSkyColor: 0x82dfff,
    hemiGroundColor: 0x36703c,
    hemiIntensity: 1.35,
    sunColor: 0xfffff0,
    sunIntensity: 2.9,
    roadColor: 0x2f3744,
    grassColor: 0x2f8238,
    curbColorA: 0x0077b6,
    curbColorB: 0xffffff,
    waterColor: 0x0096c7,
    moonColor: 0xe0f2fe,
  },
  {
    name: 'CLEAR DUSK',
    skyColor: 0x183460,
    fogColor: 0x384a70,
    fogDensity: 0.0008,
    hemiSkyColor: 0x486498,
    hemiGroundColor: 0x283824,
    hemiIntensity: 1.15,
    sunColor: 0xff8855,
    sunIntensity: 2.4,
    roadColor: 0x282c36,
    grassColor: 0x2c4a24,
    curbColorA: 0xffb703,
    curbColorB: 0xffffff,
    waterColor: 0x1a4870,
    moonColor: 0xffccaa,
  },
];
